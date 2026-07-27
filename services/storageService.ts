import { AgencyCampaign, AgencyClient, ProjectState, AssetLibraryItem } from '../types';
import { migrateDeprecatedChatModelId } from '../types/model';
import { createDefaultWorkflowState, normalizeWorkflowState } from './workflowService';
import { createDefaultCreativeDirectorState } from './creativeDirectorState';
import { normalizeAgencyClient } from './brandKitService';

const DB_NAME = 'EgoricStudioDB';
const LEGACY_DB_NAME = atob('QWlNYW5nYVN0dWRpb0RC');
const DB_MIGRATION_KEY = 'egoric_studio_db_migrated';
const DB_VERSION = 8;
const STORE_NAME = 'projects';
const ASSET_STORE_NAME = 'assetLibrary';
const CLIENT_STORE_NAME = 'agencyClients';
const CAMPAIGN_STORE_NAME = 'agencyCampaigns';
const PUBLISH_LEDGER_STORE_NAME = 'publishLedger';
const ARTICLE_LIBRARY_STORE_NAME = 'articleLibrary';
const MANAGED_ACCOUNT_STORE_NAME = 'managedAccounts';
const CAMPAIGN_ZERO_STORE_NAME = 'campaignZeroRuns';
const WORKSPACE_TOMBSTONE_STORE_NAME = 'workspaceTombstones';

export const WORKSPACE_DATA_CHANGED_EVENT = 'egoric:workspace-data-changed';

export interface WorkspaceTombstone {
  key: string;
  collection: string;
  itemId: string;
  updatedAt: number;
  deletedAt: number;
  payload: null;
}

const workspaceKeyField = (storeName: string): string => {
  if (storeName === PUBLISH_LEDGER_STORE_NAME) return 'fingerprint';
  if (storeName === CAMPAIGN_ZERO_STORE_NAME) return 'campaignId';
  return 'id';
};

const workspaceItemId = (storeName: string, item: unknown): string => {
  if (!item || typeof item !== 'object') return '';
  return String((item as Record<string, unknown>)[workspaceKeyField(storeName)] ?? '');
};

const tombstoneKey = (collection: string, itemId: string): string => `${collection}:${itemId}`;

const notifyWorkspaceDataChanged = (collection: string): void => {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_DATA_CHANGED_EVENT, { detail: { collection } }));
};

let migrationPromise: Promise<void> | null = null;

const openNamedDB = (dbName: string): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Không thể nâng cấp kho dữ liệu vì Egoric đang mở ở tab khác. Hãy đóng các tab Egoric cũ rồi tải lại trang.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CLIENT_STORE_NAME)) {
        db.createObjectStore(CLIENT_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CAMPAIGN_STORE_NAME)) {
        const store = db.createObjectStore(CAMPAIGN_STORE_NAME, { keyPath: 'id' });
        store.createIndex('clientId', 'clientId', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(PUBLISH_LEDGER_STORE_NAME)) {
        // keyPath là fingerprint để lần đăng lại cùng nội dung tìm đúng bản ghi cũ.
        const store = db.createObjectStore(PUBLISH_LEDGER_STORE_NAME, { keyPath: 'fingerprint' });
        store.createIndex('channelId', 'channelId', { unique: false });
        store.createIndex('startedAt', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(MANAGED_ACCOUNT_STORE_NAME)) {
        // Tài khoản đăng bài dùng chung cho cả workspace, không khoá theo dự án:
        // một Fanpage phục vụ nhiều campaign của cùng khách hàng.
        const store = db.createObjectStore(MANAGED_ACCOUNT_STORE_NAME, { keyPath: 'id' });
        store.createIndex('channelId', 'channelId', { unique: false });
        store.createIndex('clientId', 'clientId', { unique: false });
      }
      if (!db.objectStoreNames.contains(ARTICLE_LIBRARY_STORE_NAME)) {
        // Thư viện dùng chung cho cả workspace, không khoá theo dự án, để tìm
        // lại được bài cũ kể cả khi dự án sinh ra nó đã đóng.
        const store = db.createObjectStore(ARTICLE_LIBRARY_STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains(CAMPAIGN_ZERO_STORE_NAME)) {
        const store = db.createObjectStore(CAMPAIGN_ZERO_STORE_NAME, { keyPath: 'campaignId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(WORKSPACE_TOMBSTONE_STORE_NAME)) {
        const store = db.createObjectStore(WORKSPACE_TOMBSTONE_STORE_NAME, { keyPath: 'key' });
        store.createIndex('collection', 'collection', { unique: false });
        store.createIndex('deletedAt', 'deletedAt', { unique: false });
      }
    };
  });
};

const readStoreItems = <T>(db: IDBDatabase, storeName: string): Promise<T[]> => {
  if (!db.objectStoreNames.contains(storeName)) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as T[]) || []);
    request.onerror = () => reject(request.error);
  });
};

const writeStoreItems = <T>(db: IDBDatabase, storeName: string, items: T[]): Promise<void> => {
  if (items.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const migrateLegacyDB = async (): Promise<void> => {
  if (localStorage.getItem(DB_MIGRATION_KEY) === 'true') {
    return;
  }

  let legacyDb: IDBDatabase | null = null;
  let targetDb: IDBDatabase | null = null;

  try {
    legacyDb = await openNamedDB(LEGACY_DB_NAME);
    targetDb = await openNamedDB(DB_NAME);

    const projects = await readStoreItems<ProjectState>(legacyDb, STORE_NAME);
    const assets = await readStoreItems<AssetLibraryItem>(legacyDb, ASSET_STORE_NAME);

    await writeStoreItems(targetDb, STORE_NAME, projects);
    await writeStoreItems(targetDb, ASSET_STORE_NAME, assets);
    localStorage.setItem(DB_MIGRATION_KEY, 'true');
  } catch (error) {
    console.warn('Không thể di chuyển dữ liệu dự án cục bộ; ứng dụng sẽ tiếp tục với cơ sở dữ liệu mới.', error);
  } finally {
    legacyDb?.close();
    targetDb?.close();
  }
};

const openDB = async (): Promise<IDBDatabase> => {
  migrationPromise ??= migrateLegacyDB();
  await migrationPromise;
  return openNamedDB(DB_NAME);
};

export const saveProjectToDB = async (project: ProjectState): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const p = { ...project, lastModified: Date.now() };
    const request = store.put(p);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadProjectFromDB = async (id: string): Promise<ProjectState> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) {
        const project = request.result;
        // Bổ sung nhật ký kết xuất cho dự án cũ để tránh lỗi khi ghi dữ liệu mới.
        if (!project.renderLogs) {
          project.renderLogs = [];
        }
        if (!project.voiceStudio) {
          project.voiceStudio = createDefaultVoiceStudioState();
        }
        const migratedModel = migrateDeprecatedChatModelId(project.shotGenerationModel);
        if (project.shotGenerationModel !== migratedModel) {
          project.shotGenerationModel = migratedModel;
        }
        if (project.scriptData?.shotGenerationModel) {
          const migratedScriptModel = migrateDeprecatedChatModelId(
            project.scriptData.shotGenerationModel
          );
          if (project.scriptData.shotGenerationModel !== migratedScriptModel) {
            project.scriptData.shotGenerationModel = migratedScriptModel;
          }
        }
        resolve(normalizeWorkflowState(project));
      }
      else reject(new Error('Không tìm thấy dự án'));
    };
    request.onerror = () => reject(request.error);
  });
};

export const getAllProjectsMetadata = async (): Promise<ProjectState[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll(); 
    request.onsuccess = () => {
       const projects = (request.result as ProjectState[]).map(normalizeWorkflowState);
       projects.sort((a, b) => b.lastModified - a.lastModified);
       resolve(projects);
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveAssetToLibrary = async (item: AssetLibraryItem): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllAssetLibraryItems = async (): Promise<AssetLibraryItem[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const items = (request.result as AssetLibraryItem[]) || [];
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteAssetFromLibrary = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const deleteProjectFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    
    request.onerror = () => {
      console.error(`Không thể xóa dự án: ${id}`, request.error);
      reject(request.error);
    };
  });
};

export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Chỉ hỗ trợ tệp hình ảnh'));
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error('Kích thước ảnh không được vượt quá 10 MB'));
      return;
    }

    const reader = new FileReader();
    
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    
    reader.onerror = () => {
      reject(new Error('Không thể đọc hình ảnh'));
    };
    
    reader.readAsDataURL(file);
  });
};

export const createNewProjectState = (): ProjectState => {
  const id = 'proj_' + Date.now().toString(36);
  return {
    id,
    title: 'Dự án chưa đặt tên',
    createdAt: Date.now(),
    lastModified: Date.now(),
    stage: 'script',
    targetDuration: '60s',
    language: 'Vietnamese',
    visualStyle: 'live-action',
    shotGenerationModel: 'gpt-5.2',
    rawScript: `Tên: Kịch bản mẫu

Cảnh 1
Ngoại cảnh. Đường phố ban đêm — trời mưa
Ánh neon vỡ vụn phản chiếu trong những vũng nước.
Vị thám tử (30 tuổi, mặc áo khoác dài) đứng ở góc phố và châm một điếu thuốc.

THÁM TỬ
Bao giờ cơn mưa này mới dừng?`,
    scriptData: null,
    shots: [],
    isParsingScript: false,
    renderLogs: [],
    voiceStudio: createDefaultVoiceStudioState(),
    workflow: createDefaultWorkflowState(),
    creativeDirector: createDefaultCreativeDirectorState(),
  };
};

const putWorkspaceItem = async <T extends { id: string }>(storeName: string, item: T): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).delete(tombstoneKey(storeName, item.id));
    tx.oncomplete = () => {
      notifyWorkspaceDataChanged(storeName);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
};

const deleteWorkspaceItem = async (storeName: string, id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const deletedAt = Date.now();
    const tx = db.transaction([storeName, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).put({
      key: tombstoneKey(storeName, id),
      collection: storeName,
      itemId: id,
      updatedAt: deletedAt,
      deletedAt,
      payload: null,
    } satisfies WorkspaceTombstone);
    tx.oncomplete = () => {
      notifyWorkspaceDataChanged(storeName);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Đọc/ghi thô một kho workspace bất kỳ, phục vụ đồng bộ cloud.
 *
 * Không ràng buộc `{ id: string }` như `putWorkspaceItem`, vì sổ cái đăng bài
 * khoá theo `fingerprint`. Lớp đồng bộ biết kho nào khoá theo trường nào.
 */
export const readWorkspaceStore = async <T>(storeName: string): Promise<T[]> => {
  const db = await openDB();
  return readStoreItems<T>(db, storeName);
};

export const readWorkspaceTombstones = async (collection: string): Promise<WorkspaceTombstone[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WORKSPACE_TOMBSTONE_STORE_NAME, 'readonly');
    const index = tx.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).index('collection');
    const request = index.getAll(collection);
    request.onsuccess = () => resolve((request.result as WorkspaceTombstone[]) || []);
    request.onerror = () => reject(request.error);
  });
};

export const writeWorkspaceStore = async (storeName: string, items: unknown[]): Promise<void> => {
  if (!items.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite');
    const store = tx.objectStore(storeName);
    const tombstones = tx.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME);
    items.forEach((item) => {
      store.put(item);
      const id = workspaceItemId(storeName, item);
      if (id) tombstones.delete(tombstoneKey(storeName, id));
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteFromWorkspaceStore = async (storeName: string, keys: string[]): Promise<void> => {
  if (!keys.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    keys.forEach((key) => store.delete(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getAllAgencyClients = async (): Promise<AgencyClient[]> => {
  const db = await openDB();
  const clients = await readStoreItems<AgencyClient>(db, CLIENT_STORE_NAME);
  return clients.map(normalizeAgencyClient).sort((left, right) => right.updatedAt - left.updatedAt);
};

export const saveAgencyClient = async (client: AgencyClient): Promise<void> => putWorkspaceItem(CLIENT_STORE_NAME, client);

export const deleteAgencyClient = async (id: string): Promise<void> => deleteWorkspaceItem(CLIENT_STORE_NAME, id);

export const getAllAgencyCampaigns = async (): Promise<AgencyCampaign[]> => {
  const db = await openDB();
  const campaigns = await readStoreItems<AgencyCampaign>(db, CAMPAIGN_STORE_NAME);
  return campaigns.map((campaign) => ({
    ...campaign,
    contentPillars: Array.isArray(campaign.contentPillars) ? campaign.contentPillars : [],
  })).sort((left, right) => right.updatedAt - left.updatedAt);
};

export const saveAgencyCampaign = async (campaign: AgencyCampaign): Promise<void> => putWorkspaceItem(CAMPAIGN_STORE_NAME, campaign);

export const deleteAgencyCampaign = async (id: string): Promise<void> => deleteWorkspaceItem(CAMPAIGN_STORE_NAME, id);

/**
 * Nhật ký đăng bài.
 *
 * Khoá là fingerprint của nội dung nên lần đăng lại cùng một bài lên cùng một
 * tài khoản sẽ ghi đè đúng bản ghi cũ thay vì tạo bản ghi mới. Đây là cơ sở để
 * phát hiện đăng trùng.
 */
export const getPublishLedger = async <T>(): Promise<T[]> => {
  const db = await openDB();
  return readStoreItems<T>(db, PUBLISH_LEDGER_STORE_NAME);
};

/**
 * Không dùng putWorkspaceItem vì hàm đó ràng buộc `{ id: string }` cho các kho
 * khoá theo id. Kho này khoá theo `fingerprint`, nên có hàm ghi riêng thay vì
 * nới lỏng ràng buộc đang bảo vệ những kho kia.
 */
export const getArticleLibrary = async <T>(): Promise<T[]> => {
  const db = await openDB();
  return readStoreItems<T>(db, ARTICLE_LIBRARY_STORE_NAME);
};

export const saveArticleToLibrary = async <T extends { id: string }>(article: T): Promise<void> =>
  putWorkspaceItem(ARTICLE_LIBRARY_STORE_NAME, article);

export const deleteArticleFromLibrary = async (id: string): Promise<void> =>
  deleteWorkspaceItem(ARTICLE_LIBRARY_STORE_NAME, id);

export const getManagedAccounts = async <T>(): Promise<T[]> => {
  const db = await openDB();
  return readStoreItems<T>(db, MANAGED_ACCOUNT_STORE_NAME);
};

export const saveManagedAccount = async <T extends { id: string }>(account: T): Promise<void> =>
  putWorkspaceItem(MANAGED_ACCOUNT_STORE_NAME, account);

export const deleteManagedAccount = async (id: string): Promise<void> =>
  deleteWorkspaceItem(MANAGED_ACCOUNT_STORE_NAME, id);

export const savePublishLedgerEntry = async <T extends { fingerprint: string }>(
  entry: T,
): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PUBLISH_LEDGER_STORE_NAME, WORKSPACE_TOMBSTONE_STORE_NAME], 'readwrite');
    tx.objectStore(PUBLISH_LEDGER_STORE_NAME).put(entry);
    tx.objectStore(WORKSPACE_TOMBSTONE_STORE_NAME).delete(tombstoneKey(PUBLISH_LEDGER_STORE_NAME, entry.fingerprint));
    tx.oncomplete = () => {
      notifyWorkspaceDataChanged(PUBLISH_LEDGER_STORE_NAME);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
};

export const createDefaultVoiceStudioState = () => ({
  defaultProviderId: 'elevenlabs' as const,
  profiles: [],
  takes: [],
  selectedTakeByShot: {},
  outputFormat: 'mp3' as const,
  normalizeLoudness: true,
  pronunciationDictionary: [],
  previewText: 'Xin chào, đây là bản thử giọng của Egoric Film Studio.',
});
