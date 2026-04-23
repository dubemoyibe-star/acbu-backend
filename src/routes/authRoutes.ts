import { Router } from "express";
import {
  getPrivilegedKeys,
  postAdminMfaChallenge,
  postIssueAdminKey,
  postIssueBreakGlassKey,
  postRevokePrivilegedKey,
  postSignup,
  postSignin,
  postSignout,
  postVerify2fa,
} from "../controllers/authController";
import { validateApiKey } from "../middleware/auth";
import {
  standardRateLimiter,
  apiKeyRateLimiter,
} from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

router.use(standardRateLimiter);

router.post("/signup", postSignup);
router.post("/signin", postSignin);
router.post("/signin/verify-2fa", postVerify2fa);

// Signout requires API key
router.post("/signout", validateApiKey, apiKeyRateLimiter, postSignout);

// Privileged key lifecycle requires authenticated user + MFA challenge verification.
router.post(
  "/admin/challenge",
  validateApiKey,
  apiKeyRateLimiter,
  postAdminMfaChallenge,
);
router.post(
  "/keys/admin",
  validateApiKey,
  apiKeyRateLimiter,
  postIssueAdminKey,
);
router.post(
  "/keys/break-glass",
  validateApiKey,
  apiKeyRateLimiter,
  postIssueBreakGlassKey,
);
router.get(
  "/keys/privileged",
  validateApiKey,
  apiKeyRateLimiter,
  getPrivilegedKeys,
);
router.post(
  "/keys/:id/revoke",
  validateApiKey,
  apiKeyRateLimiter,
  postRevokePrivilegedKey,
);

export default router;
