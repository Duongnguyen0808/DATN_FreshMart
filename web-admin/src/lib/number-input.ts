/** Keep integer form values readable while allowing an empty field during editing. */
export function normalizeIntegerInput(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}
