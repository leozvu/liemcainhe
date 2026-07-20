import { DEFAULT_IMAGE_MODEL_ID, ImageModelDefinition } from '../types/model';

/** Chọn model tạo ảnh phù hợp với loại đầu vào mà không làm mất lựa chọn hợp lệ. */
export const selectImageModelForGeneration = (
  models: ImageModelDefinition[],
  preferred: ImageModelDefinition | undefined,
  hasReferenceImages: boolean,
  hasCredential: (modelId: string) => boolean,
): ImageModelDefinition | undefined => {
  if (!preferred || hasReferenceImages || !preferred.kie?.requiresReference) return preferred;

  const candidates = models.filter((model) =>
    model.isEnabled && !model.kie?.requiresReference && hasCredential(model.id)
  );
  return candidates.find((model) => model.providerId === preferred.providerId && model.id === DEFAULT_IMAGE_MODEL_ID)
    || candidates.find((model) => model.providerId === preferred.providerId)
    || candidates[0]
    || preferred;
};

