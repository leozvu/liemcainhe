import { ProjectState, AssetLibraryItem } from '../types';
import { migrateDeprecatedChatModelId } from '../types/model';

const DB_NAME = 'EgoricStudioDB';
const LEGACY_DB_NAME = atob('QWlNYW5nYVN0dWRpb0RC');
const DB_MIGRATION_KEY = 'egoric_studio_db_migrated';
const DB_VERSION = 2;
const STORE_NAME = 'projects';
const ASSET_STORE_NAME = 'assetLibrary';

let migrationPromise: Promise<void> | null = null;

const openNamedDB = (dbName: string): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
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
        resolve(project);
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
       const projects = request.result as ProjectState[];
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
  };
};

export const createDefaultVoiceStudioState = () => ({
  defaultProviderId: 'fpt' as const,
  profiles: [],
  takes: [],
  selectedTakeByShot: {},
  outputFormat: 'mp3' as const,
  normalizeLoudness: true,
});
