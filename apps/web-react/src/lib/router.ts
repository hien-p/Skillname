import { useEffect, useState } from "react";

export type Route =
  | { kind: "home" }
  | { kind: "skill"; ensName: string }
  | { kind: "publish" };

function parseHash(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/skill/")) {
    return { kind: "skill", ensName: decodeURIComponent(h.slice("#/skill/".length)) };
  }
  if (h === "#/publish") return { kind: "publish" };
  return { kind: "home" };
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    function onChange() { setRoute(parseHash()); }
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  function navigate(r: Route) {
    if (r.kind === "home") {
      history.pushState(null, "", " ");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    } else if (r.kind === "skill") {
      window.location.hash = `#/skill/${encodeURIComponent(r.ensName)}`;
    } else {
      window.location.hash = "#/publish";
    }
  }

  return [route, navigate];
}
