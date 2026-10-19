/**
 * OIDC UserInfo Endpoint
 *
 * Handles /oauth/userinfo - returns claims about the authenticated user
 */

import { Router, Request, Response } from "express";
import type { DatabaseService } from "../../services/database.js";
import type { OIDCService } from "../../services/oidc/index.js";
import { buildUserInfo, parseScopes } from "../../services/oidc/claims.js";

export function createUserInfoRouter(
  db: DatabaseService,
  oidcService: OIDCService,
): Router {
  const router = Router();

  /**
   * GET/POST /oauth/userinfo
   * Returns claims about the authenticated user
   */
  router.all("/userinfo", async (req: Request, res: Response) => {
    try {
      // Extract access token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Missing or invalid Authorization header",
        });
        return;
      }

      const accessToken = authHeader.slice(7);

      // Verify the access token
      const claims = oidcService.tokenService.verifyAccessToken(accessToken);
      if (!claims) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Invalid or expired access token",
        });
        return;
      }

      // Get scopes from the token
      const scopes = parseScopes(claims.scope);

      // Resolve the user's handle from mappings or AT Protocol API
      let handle = "";

      // Try to get handle from sessions or mappings first
      const mapping = db.getUserMapping(claims.sub, claims.client_id);
      if (mapping && mapping.handle) {
        handle = mapping.handle;
      } else {
        // Resolve DID to handle via AT Protocol API
        try {
          const response = await fetch(
            `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(claims.sub)}`,
          );
          if (response.ok) {
            const data = (await response.json()) as { handle: string };
            handle = data.handle;
          }
        } catch {
          // Fall back to DID as handle
          handle = claims.sub;
        }
      }

      // Build user info based on scopes
      const userInfo = buildUserInfo(
        {
          did: claims.sub,
          handle,
        },
        scopes,
      );

      // Include email only when requested. Never assume it is verified if
      // the PDS did not provide an email confirmation status.
      if (scopes.includes("email")) {
        const mappedEmail = db.getOIDCUserEmail(did, clientId);
        if (mappedEmail) {
          extendedInfo.email = mappedEmail.email;
          if (mappedEmail.verified !== undefined) {
            extendedInfo.email_verified = mappedEmail.verified;
          }
        }
      }

      res.json(userInfo);
    } catch (error) {
      console.error("[OIDC UserInfo] Error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: "Internal server error",
      });
    }
  });

  return router;
}
