import { createRoot } from "react-dom/client";
import { append } from "@consent-guard/ledger/adapter";
import { App } from "./App";
import { awaitingAi, createFixtureProxy, fetchAi, withAi } from "./ai";
import { NOW, loadDemo } from "./fixtures";
import { initialState } from "./state";
import "./styles.css";

// Seed state + ledger before first render so the initial ledger write happens exactly once.
// AI for the initially allowed requests is fetched through the proxy at NOW, also before first paint.
const demo = loadDemo();
const seed = initialState(demo.grants, demo.requests, NOW);
const proxy = createFixtureProxy();
Promise.all([append([], seed.events), fetchAi(proxy, seed.state, awaitingAi(seed.state), NOW)]).then(
  ([ledger, outcomes]) => {
    createRoot(document.getElementById("root")!).render(
      <App
        initial={withAi(seed.state, outcomes)}
        initialLedger={ledger}
        proxy={proxy}
        afterRevoke={demo.afterRevoke}
        afterExpire={demo.afterExpire}
        startAt={NOW}
      />,
    );
  },
);
