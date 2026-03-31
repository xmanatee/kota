/** Client-side JavaScript for the KOTA web UI (browser template literal).
 * Assembles section modules into a single IIFE exported as WEB_UI_JS. */

import { CLIENT_ACTIVE_SESSIONS_JS } from "./client-active-sessions.js";
import { CLIENT_APPROVALS_JS } from "./client-approvals.js";
import { CLIENT_CHAT_JS } from "./client-chat.js";
import { CLIENT_COST_JS } from "./client-cost.js";
import { CLIENT_EXTENSIONS_JS } from "./client-extensions.js";
import { CLIENT_KNOWLEDGE_JS } from "./client-knowledge.js";
import { CLIENT_RUN_DETAIL_JS } from "./client-run-detail.js";
import { CLIENT_SCHEDULES_JS } from "./client-schedules.js";
import { CLIENT_SESSIONS_JS } from "./client-sessions.js";
import { CLIENT_TASKS_JS } from "./client-tasks.js";
import { CLIENT_UTILS_JS } from "./client-utils.js";
import { CLIENT_WORKFLOWS_JS } from "./client-workflows.js";

export const WEB_UI_JS = /* js */ `
(function() {
  const API = window.location.origin;
  let sessionId = null;
  let sending = false;
  let activeStream = null;
  let historyViewId = null;
  var expandedTasks = {};
  var collapsedGroups = {};
  var cachedTasks = {};

  // Auth token — read from URL param on first load, persist in localStorage
  var _urlToken = new URLSearchParams(window.location.search).get("token");
  if (_urlToken) {
    localStorage.setItem("kota-auth-token", _urlToken);
    history.replaceState(null, "", window.location.pathname);
  }
  var authToken = localStorage.getItem("kota-auth-token") || "";

  function apiFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers);
    if (authToken) options.headers["Authorization"] = "Bearer " + authToken;
    return fetch(url, options);
  }

  const $messages = document.getElementById("messages");
  const $input = document.getElementById("input");
  const $send = document.getElementById("send");
  const $newChat = document.getElementById("new-chat");
  const $sessionList = document.getElementById("session-list");
  const $historyList = document.getElementById("history-list");
  const $approvalList = document.getElementById("approval-list");
  const $activeSessionsList = document.getElementById("active-sessions-list");
  const $taskList = document.getElementById("task-queue-list");
  const $workflowList = document.getElementById("workflow-runs-list");
  const $workflowControls = document.getElementById("workflow-controls");
  const $workflowHistoryFilter = document.getElementById("workflow-history-filter");
  const $costList = document.getElementById("cost-summary-list");
  const $schedulesList = document.getElementById("schedules-list");
  const $extensionsList = document.getElementById("extensions-list");
  const $knowledgeList = document.getElementById("knowledge-list");
  const $knowledgeFilter = document.getElementById("knowledge-filter");
  const $runDetail = document.getElementById("run-detail");
  const $inputArea = document.getElementById("input-area");
  const $historyViewBar = document.getElementById("history-view-bar");
  const $health = document.getElementById("health-status");
  const $sidebar = document.getElementById("sidebar");
  const $toggleSidebar = document.getElementById("toggle-sidebar");

${CLIENT_UTILS_JS}
${CLIENT_SESSIONS_JS}
${CLIENT_CHAT_JS}
${CLIENT_RUN_DETAIL_JS}
${CLIENT_WORKFLOWS_JS}
${CLIENT_TASKS_JS}
${CLIENT_APPROVALS_JS}
${CLIENT_COST_JS}
${CLIENT_ACTIVE_SESSIONS_JS}
${CLIENT_SCHEDULES_JS}
${CLIENT_EXTENSIONS_JS}
${CLIENT_KNOWLEDGE_JS}

  // --- Event listeners ---

  $send.onclick = sendMessage;

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  $input.addEventListener("input", autoResize);

  $newChat.onclick = () => {
    sessionId = null;
    showChat();
    showWelcome();
    refreshSessions();
  };

  $toggleSidebar.onclick = () => {
    $sidebar.classList.toggle("collapsed");
  };

  // --- Init ---
  showWelcome();
  checkHealth();
  refreshSessions();
  refreshHistory();
  refreshWorkflows();
  refreshTasks();
  refreshCost();
  refreshApprovals();
  refreshActiveSessions();
  refreshSchedules();
  refreshExtensions();
  refreshKnowledge();
  setInterval(checkHealth, 30000);
  setInterval(refreshSessions, 15000);
  startWorkflowUpdates();
  setInterval(refreshWorkflows, 30000);
  setInterval(refreshTasks, 30000);
  setInterval(refreshCost, 5000);
  setInterval(refreshApprovals, 30000);
  setInterval(refreshActiveSessions, 30000);
  setInterval(refreshSchedules, 30000);
  $input.focus();
})();
`;
