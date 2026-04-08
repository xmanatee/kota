/** All-workflows definitions panel for the KOTA web UI. */

export const CLIENT_WF_DEFINITIONS_JS = `
  // --- Workflow definitions panel ---

  var wfDefinitionsNotice = "";

  function setWfDefinitionsNotice(message) {
    wfDefinitionsNotice = message;
  }

  function fmtTriggerSummary(triggers) {
    if (!triggers || !triggers.length) return "manual";
    return triggers.map(function(t) {
      if (t.type === "cron") return t.schedule;
      if (t.type === "interval") return fmtIntervalMs(t.intervalMs);
      if (t.type === "webhook") return "webhook";
      if (t.type === "watch") return "watch(" + t.patterns.join(", ") + ")";
      if (t.type === "event") return t.event;
      return t.type;
    }).join(", ");
  }

  function isTriggerable(triggers) {
    if (!triggers || !triggers.length) return true;
    return triggers.some(function(t) {
      return t.type !== "cron" && t.type !== "interval";
    });
  }

  function renderWfDefinitions(definitions, statusWorkflows) {
    $wfDefinitionsList.innerHTML = "";
    if (wfDefinitionsNotice) {
      $wfDefinitionsList.innerHTML = '<div class="run-empty">' + escapeHtml(wfDefinitionsNotice) + '</div>';
      return;
    }
    if (!definitions || !definitions.length) {
      $wfDefinitionsList.innerHTML = '<div class="run-empty">No workflow definitions</div>';
      return;
    }

    var sorted = definitions.slice().sort(function(a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    for (var i = 0; i < sorted.length; i++) {
      (function(def) {
        var wfState = statusWorkflows[def.name] || {};
        var triggerDesc = fmtTriggerSummary(def.triggers);

        var statusIcon = "";
        var statusClass = "pending";
        if (wfState.lastStatus === "success") { statusIcon = "\\u2713"; statusClass = "success"; }
        else if (wfState.lastStatus === "failed") { statusIcon = "\\u2717"; statusClass = "failed"; }
        else if (wfState.lastStatus === "interrupted") { statusIcon = "\\u26a1"; statusClass = "interrupted"; }

        var lastRun = wfState.lastCompletedAt
          ? new Date(wfState.lastCompletedAt).toLocaleString()
          : (wfState.lastStartedAt ? new Date(wfState.lastStartedAt).toLocaleString() : "");

        var item = document.createElement("div");
        item.className = "schedule-item";

        var effectiveEnabled = def.runtimeEnabled !== undefined ? def.runtimeEnabled : (def.enabled !== false);

        var nameDiv = document.createElement("div");
        nameDiv.className = "schedule-name";
        nameDiv.innerHTML =
          (wfState.lastStatus
            ? '<span class="run-badge ' + statusClass + '">' + statusIcon + '</span>'
            : '<span class="run-badge pending">\\u00b7</span>') +
          escapeHtml(def.name) +
          (!effectiveEnabled ? ' <span class="run-meta">(disabled)</span>' : "");
        item.appendChild(nameDiv);

        var triggerDiv = document.createElement("div");
        triggerDiv.className = "schedule-trigger run-meta";
        triggerDiv.textContent = triggerDesc + " \\u00b7 " + def.stepCount + " step" + (def.stepCount !== 1 ? "s" : "");
        item.appendChild(triggerDiv);

        if (lastRun) {
          var lastRunDiv = document.createElement("div");
          lastRunDiv.className = "schedule-next run-meta";
          lastRunDiv.textContent = "Last: " + lastRun;
          item.appendChild(lastRunDiv);
        }

        if (def.inputSchema && def.inputSchema.properties) {
          var props = def.inputSchema.properties;
          var required = def.inputSchema.required || [];
          var fieldDescs = Object.keys(props).map(function(key) {
            var propSchema = props[key];
            var type = propSchema.type || "any";
            var req = required.indexOf(key) !== -1 ? "*" : "?";
            return key + req + ": " + type;
          });
          if (fieldDescs.length) {
            var inputsDiv = document.createElement("div");
            inputsDiv.className = "schedule-next run-meta";
            inputsDiv.textContent = "Inputs: " + fieldDescs.join(", ");
            item.appendChild(inputsDiv);
          }
        }

        if (def.outputSchema && def.outputSchema.properties) {
          var outProps = def.outputSchema.properties;
          var outFieldDescs = Object.keys(outProps).map(function(key) {
            var propSchema = outProps[key];
            var type = propSchema.type || "any";
            return key + ": " + type;
          });
          if (outFieldDescs.length) {
            var outputsDiv = document.createElement("div");
            outputsDiv.className = "schedule-next run-meta";
            outputsDiv.textContent = "Outputs: " + outFieldDescs.join(", ");
            item.appendChild(outputsDiv);
          }
        }

        if (isTriggerable(def.triggers)) {
          var btn = document.createElement("button");
          btn.className = "wf-ctrl-btn trigger";
          btn.textContent = "\\u25b6 Run";
          btn.title = "Trigger " + def.name;
          btn.onclick = (function(defRef, btnRef, itemRef) {
            return function() {
              var props = defRef.inputSchema && defRef.inputSchema.properties;
              var hasInputs = props && Object.keys(props).length > 0;
              if (!hasInputs) {
                triggerWorkflowByName(defRef.name, btnRef);
                return;
              }
              var required = defRef.inputSchema.required || [];
              var form = document.createElement("div");
              form.className = "wf-input-form";
              var fields = {};
              Object.keys(props).forEach(function(key) {
                var propSchema = props[key];
                var isReq = required.indexOf(key) !== -1;
                var type = propSchema.type || "string";
                var row = document.createElement("div");
                row.className = "wf-input-row";
                var label = document.createElement("label");
                label.className = "wf-input-label";
                label.textContent = key + (isReq ? " *" : "");
                var input;
                if (type === "boolean") {
                  input = document.createElement("input");
                  input.type = "checkbox";
                  input.className = "wf-input-checkbox";
                } else {
                  input = document.createElement("input");
                  input.type = type === "number" ? "number" : "text";
                  input.className = "wf-input-field";
                  if (propSchema.description) input.placeholder = propSchema.description;
                }
                input.setAttribute("data-key", key);
                input.setAttribute("data-required", isReq ? "1" : "0");
                input.setAttribute("data-type", type);
                fields[key] = input;
                row.appendChild(label);
                row.appendChild(input);
                form.appendChild(row);
              });
              var actions = document.createElement("div");
              actions.className = "wf-input-actions";
              var submitBtn = document.createElement("button");
              submitBtn.className = "wf-ctrl-btn trigger";
              submitBtn.textContent = "Submit";
              var cancelBtn = document.createElement("button");
              cancelBtn.className = "wf-ctrl-btn";
              cancelBtn.textContent = "Cancel";
              cancelBtn.onclick = function() {
                form.remove();
                btnRef.style.display = "";
              };
              submitBtn.onclick = function() {
                var payload = {};
                var valid = true;
                Object.keys(fields).forEach(function(key) {
                  var input = fields[key];
                  var type = input.getAttribute("data-type");
                  var isReq = input.getAttribute("data-required") === "1";
                  if (type === "boolean") {
                    payload[key] = input.checked;
                  } else if (type === "number") {
                    if (isReq && input.value === "") {
                      valid = false;
                      input.classList.add("wf-input-error");
                    } else {
                      input.classList.remove("wf-input-error");
                      if (input.value !== "") payload[key] = Number(input.value);
                    }
                  } else {
                    if (isReq && !input.value) {
                      valid = false;
                      input.classList.add("wf-input-error");
                    } else {
                      input.classList.remove("wf-input-error");
                      if (input.value) payload[key] = input.value;
                    }
                  }
                });
                if (!valid) return;
                form.remove();
                btnRef.style.display = "";
                triggerWorkflowByName(defRef.name, btnRef, payload);
              };
              actions.appendChild(submitBtn);
              actions.appendChild(cancelBtn);
              form.appendChild(actions);
              btnRef.style.display = "none";
              itemRef.appendChild(form);
            };
          })(def, btn, item);
          item.appendChild(btn);
        }

        var toggleBtn = document.createElement("button");
        toggleBtn.className = "wf-ctrl-btn";
        toggleBtn.textContent = effectiveEnabled ? "Disable" : "Enable";
        toggleBtn.title = (effectiveEnabled ? "Disable " : "Enable ") + def.name;
        toggleBtn.onclick = (function(defRef, btnRef) {
          return async function() {
            btnRef.disabled = true;
            try {
              var action = effectiveEnabled ? "disable" : "enable";
              var r = await apiFetch(API + "/api/workflow/definitions/" + encodeURIComponent(defRef.name) + "/" + action, {
                method: "POST",
              });
              if (!r.ok) {
                var d = await r.json();
                btnRef.title = d.error || "Error";
                btnRef.disabled = false;
              } else {
                setWfDefinitionsNotice("");
                await refreshWfDefinitions();
              }
            } catch {
              setWfDefinitionsNotice("Failed to update workflow state");
              btnRef.disabled = false;
            }
          };
        })(def, toggleBtn);
        item.appendChild(toggleBtn);

        $wfDefinitionsList.appendChild(item);
      })(sorted[i]);
    }
  }

  async function refreshWfDefinitions() {
    try {
      var statusRes = await apiFetch(API + "/api/workflow/status");
      var defsRes = await apiFetch(API + "/api/workflow/definitions");
      if (!statusRes.ok || !defsRes.ok) {
        setWfDefinitionsNotice("Failed to load workflow definitions");
        renderWfDefinitions([], {});
        return;
      }
      var statusData = await statusRes.json();
      var defsData = await defsRes.json();
      setWfDefinitionsNotice("");
      renderWfDefinitions(defsData.definitions || [], statusData.workflows || {});
    } catch {
      setWfDefinitionsNotice("Failed to load workflow definitions");
      renderWfDefinitions([], {});
    }
  }
`;
