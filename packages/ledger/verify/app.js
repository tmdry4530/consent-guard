import { runVerification } from "./page-logic.js";
import { parseEventsJson } from "../src/core.js";

const $ = (id) => document.getElementById(id);
const resultEl = $("result");

function showResult(res) {
  resultEl.className = res.ok ? "green" : "red";
  resultEl.textContent = "";
  const title = document.createElement("div");
  title.textContent = res.ok ? "✔ VERIFIED" : "✘ NOT VERIFIED";
  const detail = document.createElement("small");
  const source = res.anchorSource === "pasted" ? "pasted anchor" : "on-chain anchor";
  detail.textContent = `${res.reason} (${source})`;
  resultEl.append(title, detail);
}

function renderRows(badIndex) {
  const tbody = $("rows");
  tbody.textContent = "";
  let events;
  try {
    events = parseEventsJson($("events").value);
  } catch {
    tbody.innerHTML = '<tr><td colspan="7">—</td></tr>';
    return;
  }
  events.forEach((e, i) => {
    const tr = document.createElement("tr");
    if (badIndex !== undefined && i >= badIndex) tr.className = "bad";
    const cells = [e?.seq, e?.kind, e?.agentId, e?.dataset, Array.isArray(e?.fields) ? e.fields.join(", ") : "", e?.refId,
      typeof e?.hash === "string" ? `${e.hash.slice(0, 16)}…` : ""];
    cells.forEach((c, j) => {
      const td = document.createElement("td");
      if (j === 6) td.className = "mono";
      td.textContent = c ?? "";
      tr.append(td);
    });
    tbody.append(tr);
  });
}

async function verify() {
  resultEl.className = "idle";
  resultEl.textContent = "Verifying…";
  const res = await runVerification({
    eventsText: $("events").value,
    anchorSource: document.querySelector('input[name="source"]:checked').value,
    pastedHead: $("pasted").value,
    rpcUrl: $("rpc").value,
    contractId: $("contract").value,
  });
  showResult(res);
  renderRows(res.status === "chain-invalid" ? res.index : undefined);
}

$("file").addEventListener("change", async (ev) => {
  const f = ev.target.files?.[0];
  if (!f) return;
  $("events").value = await f.text();
  renderRows();
});
$("load-sample").addEventListener("click", async () => {
  $("events").value = await (await fetch("./fixtures/sample-chain.json")).text();
  renderRows();
});
$("pasted").addEventListener("input", () => {
  if ($("pasted").value.trim()) document.querySelector('input[name="source"][value="pasted"]').checked = true;
});
$("events").addEventListener("input", () => renderRows());
$("verify").addEventListener("click", verify);
