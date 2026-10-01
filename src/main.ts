import "./styles.css";
import { GameApp } from "./ui/app";

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");
new GameApp(root as HTMLElement);
