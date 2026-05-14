"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AddToChatContextButton from "@/components/AddToChatContextButton";
import { useChatContext } from "@/components/ChatContext";
import JinjaTemplateEditor from "@/components/JinjaTemplateEditor";
import {
  deleteLocalJinjaTemplate,
  fetchFmgJinjaTemplates,
  fetchJinjaLabDevices,
  fetchJinjaLabReference,
  fetchLocalJinjaGroups,
  fetchLocalJinjaTemplates,
  renderJinjaTemplate,
  saveLocalJinjaGroup,
  saveLocalJinjaTemplate,
  type JinjaLabDevice,
  type JinjaLabFmgTemplate,
  type JinjaLabGroup,
  type JinjaLabReference,
  type JinjaLabRenderResult,
  type JinjaLabTemplate,
} from "@/lib/api";

const STARTER_TEMPLATE = `config system global
    set hostname {{ DVMDB.name }}
end

{% if branch_id is defined %}
config system interface
    edit "loopback{{ branch_id|int }}"
        set type loopback
        set ip {{ loopback_cidr | ipaddr('ip_netmask') }}
    next
end
{% endif %}
`;

type RunMode = "current" | "group";

function templateLabel(t: JinjaLabTemplate) {
  return `${t.name}${t.source && t.source !== "local" ? ` (${t.source})` : ""}`;
}

function deviceLabel(d: JinjaLabDevice) {
  return [d.name, d.hostname, d.platform].filter(Boolean).join(" / ");
}

export default function JinjaTemplateLabPage() {
  const { setPageContext, clearPageContext } = useChatContext();
  const [templates, setTemplates] = useState<JinjaLabTemplate[]>([]);
  const [groups, setGroups] = useState<JinjaLabGroup[]>([]);
  const [devices, setDevices] = useState<JinjaLabDevice[]>([]);
  const [fmgTemplates, setFmgTemplates] = useState<JinjaLabFmgTemplate[]>([]);
  const [reference, setReference] = useState<JinjaLabReference | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [name, setName] = useState("new-template");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState(STARTER_TEMPLATE);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [runMode, setRunMode] = useState<RunMode>("current");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("working-group");
  const [extraVarsText, setExtraVarsText] = useState("{}");
  const [result, setResult] = useState<JinjaLabRenderResult | null>(null);
  const [status, setStatus] = useState("Loading Jinja lab...");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  );

  const selectedGroupTemplates = useMemo(
    () => selectedGroupIds
      .map((id) => templates.find((template) => template.id === id))
      .filter(Boolean) as JinjaLabTemplate[],
    [selectedGroupIds, templates],
  );

  const loadAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [localTemplates, localGroups, deviceList, ref, fmg] = await Promise.all([
        fetchLocalJinjaTemplates(),
        fetchLocalJinjaGroups(),
        fetchJinjaLabDevices(),
        fetchJinjaLabReference(),
        fetchFmgJinjaTemplates(),
      ]);
      setTemplates(localTemplates);
      setGroups(localGroups);
      setDevices(deviceList);
      setReference(ref);
      setFmgTemplates(fmg.templates);
      setSelectedDevice((prev) => prev || deviceList[0]?.name || "");
      setStatus(
        `Loaded ${localTemplates.length} local templates, ${fmg.templates.length} FMG templates, ${deviceList.length} devices.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Jinja lab data");
      setStatus("Load failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    return () => clearPageContext("tool:jinja-lab");
  }, [clearPageContext]);

  useEffect(() => {
    setPageContext({
      id: "tool:jinja-lab",
      kind: "jinja_template_lab",
      label: "Jinja CLI Template Lab",
      data: {
        selected_template: selectedTemplate
          ? {
              name: selectedTemplate.name,
              source: selectedTemplate.source,
              content,
            }
          : { name, content },
        selected_device: selectedDevice,
        run_mode: runMode,
        selected_group_templates: selectedGroupTemplates.map((template) => template.name),
        variables: result?.variables ?? [],
        missing_variables: result?.missing_variables ?? [],
        errors: result?.errors ?? [],
        rendered_preview: result?.rendered ?? "",
        context_preview: result?.context_preview ?? null,
      },
    });
  }, [
    content,
    name,
    result,
    runMode,
    selectedDevice,
    selectedGroupTemplates,
    selectedTemplate,
    setPageContext,
  ]);

  const selectTemplate = (template: JinjaLabTemplate) => {
    setSelectedId(template.id);
    setName(template.name);
    setDescription(template.description ?? "");
    setContent(template.content ?? "");
    setResult(null);
    setRunMode("current");
  };

  const newTemplate = () => {
    setSelectedId("");
    setName("new-template");
    setDescription("");
    setContent(STARTER_TEMPLATE);
    setResult(null);
    setRunMode("current");
  };

  const saveTemplate = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveLocalJinjaTemplate({
        id: selectedId || undefined,
        name,
        description,
        content,
        type: "jinja",
        target: "local",
        source: selectedTemplate?.source ?? "local",
        fmg_name: selectedTemplate?.fmg_name ?? "",
      });
      setSelectedId(saved.id);
      setTemplates(await fetchLocalJinjaTemplates());
      setStatus(`Saved local template ${saved.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteLocalJinjaTemplate(selectedId);
      setTemplates(await fetchLocalJinjaTemplates());
      newTemplate();
      setStatus("Deleted local template.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete template");
    } finally {
      setBusy(false);
    }
  };

  const importFmgTemplate = async (index: number) => {
    const source = fmgTemplates[index];
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveLocalJinjaTemplate({
        name: source.name,
        description: source.description,
        content: source.content,
        type: source.type || "jinja",
        target: source.target || "local",
        source: source.source,
        fmg_name: source.name,
      });
      const localTemplates = await fetchLocalJinjaTemplates();
      setTemplates(localTemplates);
      selectTemplate(saved);
      setStatus(`Imported ${source.name} from ${source.source} as a local editable copy.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import FMG template");
    } finally {
      setBusy(false);
    }
  };

  const parseExtraVars = () => {
    if (!extraVarsText.trim()) return {};
    const parsed = JSON.parse(extraVarsText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Extra variables must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  };

  const runRender = async () => {
    if (!selectedDevice) {
      setError("Select a device before rendering");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extraVars = parseExtraVars();
      const data =
        runMode === "group"
          ? await renderJinjaTemplate({
              device: selectedDevice,
              template_ids: selectedGroupIds,
              extra_vars: extraVars,
            })
          : await renderJinjaTemplate({
              device: selectedDevice,
              content,
              extra_vars: extraVars,
            });
      setResult(data);
      setStatus(data.ok ? "Render completed cleanly." : "Render completed with issues.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setBusy(false);
    }
  };

  const saveGroup = async () => {
    setBusy(true);
    setError(null);
    try {
      const group = await saveLocalJinjaGroup({
        name: groupName,
        template_ids: selectedGroupIds,
      });
      setGroups(await fetchLocalJinjaGroups());
      setStatus(`Saved group ${group.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save group");
    } finally {
      setBusy(false);
    }
  };

  const toggleGroupTemplate = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
    setRunMode("group");
  };

  const applyGroup = (group: JinjaLabGroup) => {
    setGroupName(group.name);
    setSelectedGroupIds(group.template_ids);
    setRunMode("group");
    setResult(null);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-[1800px] px-6 py-10 space-y-6">
        <header>
          <Link href="/tools" className="text-xs text-slate-500 hover:text-cyan-400">
            Back to tools
          </Link>
          <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Jinja CLI Template Lab</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">
                Build, import, troubleshoot, and locally render FortiManager-style
                Jinja CLI templates against live device database metadata.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AddToChatContextButton
                size="md"
                title="Attach current template lab state to AI"
                item={{
                  id: "jinja-lab:current",
                  kind: "jinja_template",
                  label: name,
                  data: {
                    name,
                    content,
                    selected_device: selectedDevice,
                    rendered: result?.rendered,
                    errors: result?.errors,
                    missing_variables: result?.missing_variables,
                  },
                }}
              />
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={busy}
                className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
          <aside className="space-y-4">
            <Panel title="Local Templates">
              <button
                type="button"
                onClick={newTemplate}
                className="mb-3 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-left text-xs text-slate-300 hover:border-cyan-700"
              >
                New template
              </button>
              <div className="max-h-64 space-y-1 overflow-auto">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => selectTemplate(template)}
                    className={`w-full rounded-md px-3 py-2 text-left text-xs transition ${
                      selectedId === template.id
                        ? "bg-cyan-950/70 text-cyan-200"
                        : "bg-slate-950 text-slate-400 hover:bg-slate-800/70"
                    }`}
                  >
                    <div className="truncate font-medium">{templateLabel(template)}</div>
                    <div className="truncate text-[11px] text-slate-600">
                      {template.description || template.target || "local copy"}
                    </div>
                  </button>
                ))}
                {templates.length === 0 && (
                  <div className="text-xs text-slate-600">No local templates yet.</div>
                )}
              </div>
            </Panel>

            <Panel title="Import From FMG">
              <select
                disabled={busy || fmgTemplates.length === 0}
                defaultValue=""
                onChange={(event) => {
                  const index = Number(event.target.value);
                  event.target.value = "";
                  if (Number.isFinite(index)) void importFmgTemplate(index);
                }}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-700"
              >
                <option value="">Select template/script...</option>
                {fmgTemplates.map((template, index) => (
                  <option key={`${template.source}:${template.name}:${index}`} value={index}>
                    {template.source}: {template.name}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-[11px] text-slate-600">
                Imported templates are local app copies only.
              </div>
            </Panel>

            <Panel title="Device Context">
              <select
                value={selectedDevice}
                onChange={(event) => setSelectedDevice(event.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-700"
              >
                <option value="">Select device...</option>
                {devices.map((device) => (
                  <option key={device.name} value={device.name}>
                    {deviceLabel(device)}
                  </option>
                ))}
              </select>
              <textarea
                value={extraVarsText}
                onChange={(event) => setExtraVarsText(event.target.value)}
                spellCheck={false}
                className="mt-3 h-28 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-300 outline-none focus:border-cyan-700"
              />
            </Panel>

            <Panel title="Template Group">
              <div className="space-y-2">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => applyGroup(group)}
                    className="w-full rounded-md bg-slate-950 px-3 py-2 text-left text-xs text-slate-400 hover:bg-slate-800/70"
                  >
                    <div className="truncate font-medium text-slate-300">{group.name}</div>
                    <div className="text-[11px] text-slate-600">
                      {group.template_ids.length} templates
                    </div>
                  </button>
                ))}
              </div>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                className="mt-3 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none focus:border-cyan-700"
              />
              <div className="mt-3 max-h-44 space-y-1 overflow-auto">
                {templates.map((template) => (
                  <label key={template.id} className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={selectedGroupIds.includes(template.id)}
                      onChange={() => toggleGroupTemplate(template.id)}
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-cyan-600"
                    />
                    <span className="truncate">{template.name}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void saveGroup()}
                disabled={busy || selectedGroupIds.length === 0}
                className="mt-3 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 hover:border-cyan-700 disabled:opacity-50"
              >
                Save group
              </button>
            </Panel>
          </aside>

          <section className="min-w-0 space-y-4">
            <Panel title="Editor">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-700"
                />
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Description"
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300 outline-none focus:border-cyan-700"
                />
              </div>
              <JinjaTemplateEditor
                value={content}
                onChange={(nextContent) => {
                  setContent(nextContent);
                  setResult(null);
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-slate-600">
                  {content.length.toLocaleString()} chars. {status}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveTemplate()}
                    disabled={busy || !name.trim()}
                    className="rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600"
                  >
                    Save local
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteTemplate()}
                    disabled={busy || !selectedId}
                    className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-400 hover:border-red-800 hover:text-red-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunMode("current");
                      void runRender();
                    }}
                    disabled={busy || !selectedDevice}
                    className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50"
                  >
                    Render current
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunMode("group");
                      void runRender();
                    }}
                    disabled={busy || !selectedDevice || selectedGroupIds.length === 0}
                    className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50 disabled:opacity-50"
                  >
                    Render group
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Preview">
              {result ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <Badge tone={result.ok ? "green" : "amber"}>{result.ok ? "OK" : "Needs attention"}</Badge>
                    <Badge>{result.variables.length} variables</Badge>
                    <Badge>{result.referenced_templates.length} includes/imports</Badge>
                    <Badge>{result.sections.length} section(s)</Badge>
                  </div>
                  {result.errors.length > 0 && (
                    <IssueList title="Syntax/runtime errors" items={result.errors.map((err) => `${err.template ? `${err.template}: ` : ""}${err.type}${err.lineno ? ` line ${err.lineno}` : ""}: ${err.message}`)} />
                  )}
                  {result.missing_variables.length > 0 && (
                    <IssueList title="Missing metadata/extra variables" items={result.missing_variables} />
                  )}
                  <pre className="max-h-[520px] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-4 font-mono text-[12px] leading-relaxed text-slate-200">
                    {result.rendered || "No rendered output."}
                  </pre>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-800 bg-slate-950 p-10 text-center text-sm text-slate-600">
                  Select a device and render the template or group.
                </div>
              )}
            </Panel>
          </section>

          <aside className="space-y-4">
            <Panel title="FortiManager Variables">
              <ReferenceList
                rows={[
                  ...(reference?.predefined_variables ?? []),
                  ...(reference?.interface_variables ?? []),
                ]}
              />
            </Panel>

            <Panel title="Filters">
              <div className="flex flex-wrap gap-2">
                {(reference?.filters ?? []).map((filter) => (
                  <span
                    key={filter}
                    className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-400"
                  >
                    {filter}
                  </span>
                ))}
              </div>
            </Panel>

            <Panel title="Render Context">
              {result?.context_preview ? (
                <pre className="max-h-80 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-400">
                  {JSON.stringify(result.context_preview, null, 2)}
                </pre>
              ) : (
                <div className="text-xs text-slate-600">
                  Render a template to inspect DVMDB, metadata, and interface context.
                </div>
              )}
            </Panel>

            <Panel title="FMG Notes">
              <ul className="space-y-2 text-xs leading-relaxed text-slate-500">
                {(reference?.notes ?? []).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">{title}</h2>
      {children}
    </section>
  );
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" }) {
  const classes = {
    slate: "border-slate-800 bg-slate-950 text-slate-400",
    green: "border-emerald-800 bg-emerald-950/50 text-emerald-300",
    amber: "border-amber-800 bg-amber-950/50 text-amber-300",
  };
  return <span className={`rounded-full border px-2 py-1 ${classes[tone]}`}>{children}</span>;
}

function IssueList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3">
      <div className="text-xs font-semibold text-amber-300">{title}</div>
      <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
        {items.map((item) => (
          <li key={item} className="font-mono">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ReferenceList({
  rows,
}: {
  rows: { name: string; description: string; example?: string }[];
}) {
  return (
    <div className="max-h-80 space-y-2 overflow-auto">
      {rows.map((row) => (
        <div key={row.name} className="rounded-md border border-slate-800 bg-slate-950 p-2">
          <div className="font-mono text-[11px] text-cyan-300">{row.name}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {row.description}
          </div>
        </div>
      ))}
    </div>
  );
}
