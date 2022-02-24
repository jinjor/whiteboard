export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return a === b;
  }
  if (a === null || b === null) {
    return false;
  }
  const keys1 = Object.keys(a).sort();
  const keys2 = Object.keys(b).sort();
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (let i = 0; i < keys1.length; i++) {
    const key1 = keys1[i];
    const key2 = keys2[i];
    if (key1 !== key2) {
      return false;
    }
    const value1 = a[key1];
    const value2 = b[key2];
    if (!deepEqual(value1, value2)) {
      return false;
    }
  }
  return true;
}
