import { readLimits } from '../../utils/usage'

// How much of the Claude plan's limits is used, as of the last Claude run on this machine (null before the first).
export default defineEventHandler(() => readLimits())
