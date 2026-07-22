const archiveSteps = new Map<
  number,
  string
>();


export function setArchiveStep(
  userId: number,
  step: string
) {

  archiveSteps.set(
    userId,
    step
  );

}


export function getArchiveStep(
  userId: number
) {

  return archiveSteps.get(
    userId
  );

}


export function clearArchiveStep(
  userId: number
) {

  archiveSteps.delete(
    userId
  );

}