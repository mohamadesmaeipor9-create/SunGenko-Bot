const activeUploads = new Map<number, number>();


export function setUploadSession(
  adminId: number,
  sessionId: number
) {
  activeUploads.set(
    adminId,
    sessionId
  );
}


export function getUploadSession(
  adminId: number
) {
  return activeUploads.get(adminId);
}


export function clearUploadSession(
  adminId: number
) {
  activeUploads.delete(adminId);
}