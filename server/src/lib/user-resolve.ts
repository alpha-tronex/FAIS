import { User } from '../models.js';

/**
 * Resolve username (uname) to user _id string, or null if not found.
 */
export async function resolveUsername(uname: string): Promise<string | null> {
  const user = await User.findOne({ uname: uname.trim() }).select('_id').lean();
  return user ? String(user._id) : null;
}
