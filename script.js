const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#fileInput");
const statusEl = document.querySelector("#status");
const previewImg = document.querySelector("#pngPreview");
const emptyPreview = document.querySelector("#emptyPreview");
const downloadBtn = document.querySelector("#downloadBtn");
const fileMeta = document.querySelector("#fileMeta");

let pngUrl = "";
let downloadName = "converted.png";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function resetResult() {
  if (pngUrl) {
    URL.revokeObjectURL(pngUrl);
  }

  pngUrl = "";
  previewImg.removeAttribute("src");
  previewImg.classList.remove("ready");
  emptyPreview.hidden = false;
  downloadBtn.disabled = true;
  fileMeta.textContent = "尚未生成图片";
}

function getPngName(fileName) {
  return fileName.replace(/\.svg$/i, "") + ".png";
}

function decodeSvgBuffer(buffer) {
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  const header = new TextDecoder("latin1").decode(buffer.slice(0, 256));
  const encodingMatch = header.match(/encoding=["']([^"']+)["']/i);
  const declaredEncoding = encodingMatch?.[1]?.toLowerCase();

  if (declaredEncoding && declaredEncoding !== "utf-8") {
    try {
      return new TextDecoder(declaredEncoding).decode(buffer);
    } catch {
      // Unsupported labels fall through to the UTF-8/GB18030 path.
    }
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("gb18030").decode(buffer);
  }
}

function ensureSvgNamespace(svgText) {
  if (!/<svg[\s>]/i.test(svgText)) {
    throw new Error("请选择有效的 SVG 文件。");
  }

  if (/xmlns=(["'])http:\/\/www\.w3\.org\/2000\/svg\1/i.test(svgText)) {
    return svgText;
  }

  return svgText.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

function parseLength(value) {
  if (!value) {
    return 0;
  }

  const match = String(value).trim().match(/^([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

function getSvgSize(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("SVG 解析失败，请检查文件内容。");
  }

  const svg = doc.documentElement;
  const width = parseLength(svg.getAttribute("width"));
  const height = parseLength(svg.getAttribute("height"));

  if (width > 0 && height > 0) {
    return { width, height };
  }

  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);

    if (values.length === 4 && values[2] > 0 && values[3] > 0) {
      return { width: values[2], height: values[3] };
    }
  }

  return { width: 1024, height: 1024 };
}

function inlineFontFallback(svgText) {
  const fontStack =
    '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", Arial, sans-serif';
  const style = `<style>svg,text,tspan{font-family:${fontStack};}</style>`;

  if (/<style[\s>]/i.test(svgText)) {
    return svgText.replace(/<style\b[^>]*>/i, (match) => `${match}svg,text,tspan{font-family:${fontStack};}`);
  }

  return svgText.replace(/<svg\b[^>]*>/i, (match) => `${match}${style}`);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，无法转换该 SVG。"));
    image.src = src;
  });
}

async function convertSvgFile(file) {
  if (!file || (!file.type.includes("svg") && !/\.svg$/i.test(file.name))) {
    throw new Error("请上传 .svg 文件。");
  }

  resetResult();
  setStatus("正在读取 SVG 文件...");

  const buffer = await file.arrayBuffer();
  const decodedSvg = decodeSvgBuffer(buffer);
  const svgText = inlineFontFallback(ensureSvgNamespace(decodedSvg));
  const size = getSvgSize(svgText);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("PNG 生成失败。");
    }

    pngUrl = URL.createObjectURL(blob);
    downloadName = getPngName(file.name);
    previewImg.src = pngUrl;
    previewImg.classList.add("ready");
    emptyPreview.hidden = true;
    downloadBtn.disabled = false;
    fileMeta.textContent = `${file.name} -> ${Math.round(size.width)} x ${Math.round(size.height)} PNG`;
    setStatus("转换完成。");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function handleFile(file) {
  try {
    await convertSvgFile(file);
  } catch (error) {
    resetResult();
    setStatus(error.message || "转换失败。", true);
  }
}

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  handleFile(file);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  const [file] = event.dataTransfer.files;
  handleFile(file);
});

downloadBtn.addEventListener("click", () => {
  if (!pngUrl) {
    return;
  }

  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = downloadName;
  document.body.append(link);
  link.click();
  link.remove();
});
