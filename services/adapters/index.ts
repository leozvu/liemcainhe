/**
 * Điểm xuất chung cho các bộ điều hợp mô hình
 */

export * from './chatAdapter';
export {
  callImageApi,
  isAspectRatioSupported as isImageAspectRatioSupported,
} from './imageAdapter';
export {
  callVideoApi,
  isAspectRatioSupported as isVideoAspectRatioSupported,
  isDurationSupported,
} from './videoAdapter';
export { callReplicateImageApi, callReplicateVideoApi } from './replicateAdapter';
