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
import type * as adminMeta from "../adminMeta.js";
import type * as agentoverflow from "../agentoverflow.js";
import type * as agentoverflowAdmin from "../agentoverflowAdmin.js";
import type * as agentoverflowHttp from "../agentoverflowHttp.js";
import type * as agentoverflowMcp from "../agentoverflowMcp.js";
import type * as agentoverflowPublic from "../agentoverflowPublic.js";
import type * as ai from "../ai.js";
import type * as aiFiles from "../aiFiles.js";
import type * as aiHelpers from "../aiHelpers.js";
import type * as analytics from "../analytics.js";
import type * as antiEvasionDb from "../antiEvasionDb.js";
import type * as codeApiKeys from "../codeApiKeys.js";
import type * as codeBranches from "../codeBranches.js";
import type * as codeCommands from "../codeCommands.js";
import type * as codeDeletion from "../codeDeletion.js";
import type * as codePipeline from "../codePipeline.js";
import type * as codeProjects from "../codeProjects.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as customAuth from "../customAuth.js";
import type * as customAuthHelpers from "../customAuthHelpers.js";
import type * as deployments from "../deployments.js";
import type * as desktopAuth from "../desktopAuth.js";
import type * as desktopAuthActions from "../desktopAuthActions.js";
import type * as desktopIsoCatalog from "../desktopIsoCatalog.js";
import type * as github from "../github.js";
import type * as githubActionsRunner from "../githubActionsRunner.js";
import type * as githubAutoCreate from "../githubAutoCreate.js";
import type * as githubHelpers from "../githubHelpers.js";
import type * as githubQueries from "../githubQueries.js";
import type * as githubSync from "../githubSync.js";
import type * as githubSyncHelpers from "../githubSyncHelpers.js";
import type * as githubWebhooks from "../githubWebhooks.js";
import type * as gravityAds from "../gravityAds.js";
import type * as http from "../http.js";
import type * as lib_agentCore from "../lib/agentCore.js";
import type * as lib_agentOutputParser from "../lib/agentOutputParser.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_codeAuth from "../lib/codeAuth.js";
import type * as lib_deadlySignalsClient from "../lib/deadlySignalsClient.js";
import type * as lib_mcpClient from "../lib/mcpClient.js";
import type * as lib_mcpParse from "../lib/mcpParse.js";
import type * as lib_modalClient from "../lib/modalClient.js";
import type * as lib_modePrompts from "../lib/modePrompts.js";
import type * as lib_modelscopeClient from "../lib/modelscopeClient.js";
import type * as lib_obscureRepoGenerator from "../lib/obscureRepoGenerator.js";
import type * as lib_ollamaClient from "../lib/ollamaClient.js";
import type * as lib_openrouterClient from "../lib/openrouterClient.js";
import type * as lib_studyPrompt from "../lib/studyPrompt.js";
import type * as lib_taskTypes from "../lib/taskTypes.js";
import type * as lib_vlyIntegrations from "../lib/vlyIntegrations.js";
import type * as lib_zenClient from "../lib/zenClient.js";
import type * as mcpServers from "../mcpServers.js";
import type * as providerLog from "../providerLog.js";
import type * as rag from "../rag.js";
import type * as ragHelpers from "../ragHelpers.js";
import type * as sketchfabMcp from "../sketchfabMcp.js";
import type * as study from "../study.js";
import type * as studyHelpers from "../studyHelpers.js";
import type * as studyTasks from "../studyTasks.js";
import type * as userApiKeys from "../userApiKeys.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminMeta: typeof adminMeta;
  agentoverflow: typeof agentoverflow;
  agentoverflowAdmin: typeof agentoverflowAdmin;
  agentoverflowHttp: typeof agentoverflowHttp;
  agentoverflowMcp: typeof agentoverflowMcp;
  agentoverflowPublic: typeof agentoverflowPublic;
  ai: typeof ai;
  aiFiles: typeof aiFiles;
  aiHelpers: typeof aiHelpers;
  analytics: typeof analytics;
  antiEvasionDb: typeof antiEvasionDb;
  codeApiKeys: typeof codeApiKeys;
  codeBranches: typeof codeBranches;
  codeCommands: typeof codeCommands;
  codeDeletion: typeof codeDeletion;
  codePipeline: typeof codePipeline;
  codeProjects: typeof codeProjects;
  conversations: typeof conversations;
  crons: typeof crons;
  customAuth: typeof customAuth;
  customAuthHelpers: typeof customAuthHelpers;
  deployments: typeof deployments;
  desktopAuth: typeof desktopAuth;
  desktopAuthActions: typeof desktopAuthActions;
  desktopIsoCatalog: typeof desktopIsoCatalog;
  github: typeof github;
  githubActionsRunner: typeof githubActionsRunner;
  githubAutoCreate: typeof githubAutoCreate;
  githubHelpers: typeof githubHelpers;
  githubQueries: typeof githubQueries;
  githubSync: typeof githubSync;
  githubSyncHelpers: typeof githubSyncHelpers;
  githubWebhooks: typeof githubWebhooks;
  gravityAds: typeof gravityAds;
  http: typeof http;
  "lib/agentCore": typeof lib_agentCore;
  "lib/agentOutputParser": typeof lib_agentOutputParser;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/codeAuth": typeof lib_codeAuth;
  "lib/deadlySignalsClient": typeof lib_deadlySignalsClient;
  "lib/mcpClient": typeof lib_mcpClient;
  "lib/mcpParse": typeof lib_mcpParse;
  "lib/modalClient": typeof lib_modalClient;
  "lib/modePrompts": typeof lib_modePrompts;
  "lib/modelscopeClient": typeof lib_modelscopeClient;
  "lib/obscureRepoGenerator": typeof lib_obscureRepoGenerator;
  "lib/ollamaClient": typeof lib_ollamaClient;
  "lib/openrouterClient": typeof lib_openrouterClient;
  "lib/studyPrompt": typeof lib_studyPrompt;
  "lib/taskTypes": typeof lib_taskTypes;
  "lib/vlyIntegrations": typeof lib_vlyIntegrations;
  "lib/zenClient": typeof lib_zenClient;
  mcpServers: typeof mcpServers;
  providerLog: typeof providerLog;
  rag: typeof rag;
  ragHelpers: typeof ragHelpers;
  sketchfabMcp: typeof sketchfabMcp;
  study: typeof study;
  studyHelpers: typeof studyHelpers;
  studyTasks: typeof studyTasks;
  userApiKeys: typeof userApiKeys;
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
