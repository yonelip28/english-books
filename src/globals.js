// The app code (app.jsx) was written for CDN <script> tags and uses these as plain
// globals. They now come from npm packages; this file installs them on `window`
// BEFORE app.jsx runs (main.jsx imports it first).
import React from "react";
import ReactDOMBase from "react-dom";
import ReactDOMClient from "react-dom/client";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import * as pdfjsNs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import * as pakoNs from "pako";
import Tesseract from "tesseract.js";
import localforage from "localforage";
import { appStorage } from "./appStorage.js";

const pdfjsLib = pdfjsNs.getDocument ? pdfjsNs : pdfjsNs.default;
const pako = pakoNs.deflate ? pakoNs : pakoNs.default;

window.React = React;
window.ReactDOM = { ...ReactDOMBase, ...ReactDOMClient };
window.firebase = firebase;
window.pdfjsLib = pdfjsLib;
window.__PDF_WORKER_URL__ = pdfWorkerUrl; // read by app.jsx when it sets pdf.js's worker
window.pako = pako;
window.Tesseract = Tesseract;
window.localforage = localforage;
window.appStorage = appStorage;
