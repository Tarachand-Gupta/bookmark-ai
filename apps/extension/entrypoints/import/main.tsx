import React from "react";
import ReactDOM from "react-dom/client";
import "../../assets/tailwind.css";
import { ImportApp } from "./ImportApp";

document.documentElement.classList.toggle(
  "dark",
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.body.style.width = "100%";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ImportApp />
  </React.StrictMode>,
);
