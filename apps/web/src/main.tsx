import { createRoot } from "react-dom/client";
import { App } from "./App";
import { NOW, loadDemo } from "./fixtures";
import { append } from "./ledgerAdapter";
import { initialState } from "./state";
import "./styles.css";

// Seed state + ledger before first render so the initial ledger write happens exactly once.
const demo = loadDemo();
const seed = initialState(demo.grants, demo.requests, NOW);
append([], seed.events).then((ledger) => {
  createRoot(document.getElementById("root")!).render(
    <App initial={seed.state} initialLedger={ledger} afterRevoke={demo.afterRevoke} startAt={NOW} />,
  );
});
