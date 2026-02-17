export type RegistrationFormValues = {
  uname: string;
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  ssn: string;
  confirmSsn: string;
};

// Minimal, typical regexes (intentionally not overly strict).
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts common US formats: (555) 555-5555, 555-555-5555, 5555555555, +1 555 555 5555
export const PHONE_REGEX = /^(?:\+?1\s*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}$/;

// Accepts ###-##-#### or #########
export const SSN_REGEX = /^(?:\d{3}-\d{2}-\d{4}|\d{9})$/;

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

export function validateRegistration(values: RegistrationFormValues): string[] {
  const errors: string[] = [];

  // Required fields (everything except Address line 2)
  if (isBlank(values.uname)) errors.push('Username is required');
  if (isBlank(values.email)) errors.push('Email is required');
  if (isBlank(values.firstName)) errors.push('First name is required');
  if (isBlank(values.lastName)) errors.push('Last name is required');
  if (isBlank(values.addressLine1)) errors.push('Address line 1 is required');
  // Address line 2 optional
  if (isBlank(values.city)) errors.push('City is required');
  if (isBlank(values.state)) errors.push('State is required');
  if (isBlank(values.zipCode)) errors.push('Zip code is required');
  if (isBlank(values.phone)) errors.push('Phone is required');
  if (isBlank(values.ssn)) errors.push('Social security is required');
  if (isBlank(values.confirmSsn)) errors.push('Confirm social security is required');
  if (isBlank(values.password)) errors.push('Password is required');
  if (isBlank(values.confirmPassword)) errors.push('Confirm password is required');

  if (!isBlank(values.email) && !EMAIL_REGEX.test(values.email.trim())) {
    errors.push('Email format is invalid');
  }

  if (!isBlank(values.phone) && !PHONE_REGEX.test(values.phone.trim())) {
    errors.push('Phone format is invalid');
  }

  if (!isBlank(values.ssn) && !SSN_REGEX.test(values.ssn.trim())) {
    errors.push('Social security format is invalid');
  }

  if (!isBlank(values.confirmSsn) && !SSN_REGEX.test(values.confirmSsn.trim())) {
    errors.push('Confirm social security format is invalid');
  }

  if (!isBlank(values.ssn) && !isBlank(values.confirmSsn) && values.ssn.trim() !== values.confirmSsn.trim()) {
    errors.push('Social security numbers do not match');
  }

  if (!isBlank(values.password) && values.password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!isBlank(values.password) && !isBlank(values.confirmPassword) && values.password !== values.confirmPassword) {
    errors.push('Passwords do not match');
  }

  return errors;
}
