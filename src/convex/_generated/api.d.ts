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
import type * as agentPipeline from "../agentPipeline.js";
import type * as agentTeamHelpers from "../agentTeamHelpers.js";
import type * as agentoverflow from "../agentoverflow.js";
import type * as agentoverflowAdmin from "../agentoverflowAdmin.js";
import type * as agentoverflowHttp from "../agentoverflowHttp.js";
import type * as ai from "../ai.js";
import type * as aiHelpers from "../aiHelpers.js";
import type * as antiEvasionDb from "../antiEvasionDb.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as codeApiKeys from "../codeApiKeys.js";
import type * as codeAuth from "../codeAuth.js";
import type * as codeBranches from "../codeBranches.js";
import type * as codeCommands from "../codeCommands.js";
import type * as codeMigration from "../codeMigration.js";
import type * as codePipeline from "../codePipeline.js";
import type * as codeProjects from "../codeProjects.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as customAuth from "../customAuth.js";
import type * as customAuthHelpers from "../customAuthHelpers.js";
import type * as dailyReset from "../dailyReset.js";
import type * as deployments from "../deployments.js";
import type * as desktopAuth from "../desktopAuth.js";
import type * as desktopAuthActions from "../desktopAuthActions.js";
import type * as desktopIsoCatalog from "../desktopIsoCatalog.js";
import type * as fileSync from "../fileSync.js";
import type * as github from "../github.js";
import type * as githubAutoCreate from "../githubAutoCreate.js";
import type * as githubHelpers from "../githubHelpers.js";
import type * as githubQueries from "../githubQueries.js";
import type * as githubStorage from "../githubStorage.js";
import type * as githubSync from "../githubSync.js";
import type * as githubSyncHelpers from "../githubSyncHelpers.js";
import type * as githubWebhooks from "../githubWebhooks.js";
import type * as gravityAds from "../gravityAds.js";
import type * as hfRagSpace from "../hfRagSpace.js";
import type * as http from "../http.js";
import type * as obscureRepoGenerator from "../obscureRepoGenerator.js";
import type * as payments from "../payments.js";
import type * as qemuSandbox from "../qemuSandbox.js";
import type * as rag from "../rag.js";
import type * as ragHelpers from "../ragHelpers.js";
import type * as sandbox from "../sandbox.js";
import type * as sandboxHelpers from "../sandboxHelpers.js";
import type * as study from "../study.js";
import type * as studyHelpers from "../studyHelpers.js";
import type * as userApiKeys from "../userApiKeys.js";
import type * as users from "../users.js";
import type * as v86Sandbox from "../v86Sandbox.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agentCore: typeof agentCore;
  agentPipeline: typeof agentPipeline;
  agentTeamHelpers: typeof agentTeamHelpers;
  agentoverflow: typeof agentoverflow;
  agentoverflowAdmin: typeof agentoverflowAdmin;
  agentoverflowHttp: typeof agentoverflowHttp;
  ai: typeof ai;
  aiHelpers: typeof aiHelpers;
  antiEvasionDb: typeof antiEvasionDb;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  codeApiKeys: typeof codeApiKeys;
  codeAuth: typeof codeAuth;
  codeBranches: typeof codeBranches;
  codeCommands: typeof codeCommands;
  codeMigration: typeof codeMigration;
  codePipeline: typeof codePipeline;
  codeProjects: typeof codeProjects;
  conversations: typeof conversations;
  crons: typeof crons;
  customAuth: typeof customAuth;
  customAuthHelpers: typeof customAuthHelpers;
  dailyReset: typeof dailyReset;
  deployments: typeof deployments;
  desktopAuth: typeof desktopAuth;
  desktopAuthActions: typeof desktopAuthActions;
  desktopIsoCatalog: typeof desktopIsoCatalog;
  fileSync: typeof fileSync;
  github: typeof github;
  githubAutoCreate: typeof githubAutoCreate;
  githubHelpers: typeof githubHelpers;
  githubQueries: typeof githubQueries;
  githubStorage: typeof githubStorage;
  githubSync: typeof githubSync;
  githubSyncHelpers: typeof githubSyncHelpers;
  githubWebhooks: typeof githubWebhooks;
  gravityAds: typeof gravityAds;
  hfRagSpace: typeof hfRagSpace;
  http: typeof http;
  obscureRepoGenerator: typeof obscureRepoGenerator;
  payments: typeof payments;
  qemuSandbox: typeof qemuSandbox;
  rag: typeof rag;
  ragHelpers: typeof ragHelpers;
  sandbox: typeof sandbox;
  sandboxHelpers: typeof sandboxHelpers;
  study: typeof study;
  studyHelpers: typeof studyHelpers;
  userApiKeys: typeof userApiKeys;
  users: typeof users;
  v86Sandbox: typeof v86Sandbox;
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
