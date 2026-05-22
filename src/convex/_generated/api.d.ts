/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agentCore from "../agentCore.js";
import type * as agentTeam from "../agentTeam.js";
import type * as agentTeamHelpers from "../agentTeamHelpers.js";
import type * as ai from "../ai.js";
import type * as aiHelpers from "../aiHelpers.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as customAuth from "../customAuth.js";
import type * as customAuthHelpers from "../customAuthHelpers.js";
import type * as dailyReset from "../dailyReset.js";
import type * as fileSync from "../fileSync.js";
import type * as github from "../github.js";
import type * as githubHelpers from "../githubHelpers.js";
import type * as hfRagSpace from "../hfRagSpace.js";
import type * as http from "../http.js";
import type * as rag from "../rag.js";
import type * as ragHelpers from "../ragHelpers.js";
import type * as sandbox from "../sandbox.js";
import type * as sandboxHelpers from "../sandboxHelpers.js";
import type * as study from "../study.js";
import type * as studyHelpers from "../studyHelpers.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agentCore: typeof agentCore;
  agentTeam: typeof agentTeam;
  agentTeamHelpers: typeof agentTeamHelpers;
  ai: typeof ai;
  aiHelpers: typeof aiHelpers;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  conversations: typeof conversations;
  crons: typeof crons;
  customAuth: typeof customAuth;
  customAuthHelpers: typeof customAuthHelpers;
  dailyReset: typeof dailyReset;
  fileSync: typeof fileSync;
  github: typeof github;
  githubHelpers: typeof githubHelpers;
  hfRagSpace: typeof hfRagSpace;
  http: typeof http;
  rag: typeof rag;
  ragHelpers: typeof ragHelpers;
  sandbox: typeof sandbox;
  sandboxHelpers: typeof sandboxHelpers;
  study: typeof study;
  studyHelpers: typeof studyHelpers;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
