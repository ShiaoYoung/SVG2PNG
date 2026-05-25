const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tool-panel");

const svgDropZone = document.querySelector("#svgDropZone");
const svgFileInput = document.querySelector("#svgFileInput");
const svgStatus = document.querySelector("#svgStatus");
const pngPreview = document.querySelector("#pngPreview");
const pngEmptyPreview = document.querySelector("#pngEmptyPreview");
const pngDownloadBtn = document.querySelector("#pngDownloadBtn");
const svgFileMeta = document.querySelector("#svgFileMeta");

const imageDropZone = document.querySelector("#imageDropZone");
const imageFileInput = document.querySelector("#imageFileInput");
const imageStatus = document.querySelector("#imageStatus");
const svgPreview = document.querySelector("#svgPreview");
const svgEmptyPreview = document.querySelector("#svgEmptyPreview");
const svgDownloadBtn = document.querySelector("#svgDownloadBtn");
const imageFileMeta = document.querySelector("#imageFileMeta");
const whiteTolerance = document.querySelector("#whiteTolerance");
const whiteToleranceValue = document.querySelector("#whiteToleranceValue");

let pngUrl = "";
let pngDownloadName = "converted.png";
let svgUrl = "";
let svgDownloadName = "converted.svg";
let lastImageFile = null;

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function revokeUrl(url) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function resetSvgToPngResult() {
  revokeUrl(pngUrl);
  pngUrl = "";
  pngPreview.removeAttribute("src");
  pngPreview.classList.remove("ready");
  pngEmptyPreview.hidden = false;
  pngDownloadBtn.disabled = true;
  svgFileMeta.textContent = "尚未生成图片";
}

function resetImageToSvgResult() {
  revokeUrl(svgUrl);
  svgUrl = "";
  svgPreview.removeAttribute("src");
  svgPreview.classList.remove("ready");
  svgEmptyPreview.hidden = false;
  svgDownloadBtn.disabled = true;
  imageFileMeta.textContent = "尚未生成 SVG";
}

function getOutputName(fileName, extension) {
  return fileName.replace(/\.[^.]+$/i, "") + extension;
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    image.onerror = () => reject(new Error("图片加载失败，无法转换该文件。"));
    image.src = src;
  });
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("图片生成失败。"));
      }
    }, type);
  });
}

async function convertSvgFile(file) {
  if (!file || (!file.type.includes("svg") && !/\.svg$/i.test(file.name))) {
    throw new Error("请上传 .svg 文件。");
  }

  resetSvgToPngResult();
  setStatus(svgStatus, "正在读取 SVG 文件...");

  const buffer = await file.arrayBuffer();
  const decodedSvg = decodeSvgBuffer(buffer);
  const svgText = inlineFontFallback(ensureSvgNamespace(decodedSvg));
  const size = getSvgSize(svgText);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const sourceSvgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(sourceSvgUrl);
    const canvas = document.createElement("canvas");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));

    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);

    const blob = await canvasToBlob(canvas, "image/png");
    pngUrl = URL.createObjectURL(blob);
    pngDownloadName = getOutputName(file.name, ".png");
    pngPreview.src = pngUrl;
    pngPreview.classList.add("ready");
    pngEmptyPreview.hidden = true;
    pngDownloadBtn.disabled = false;
    svgFileMeta.textContent = `${file.name} -> ${Math.round(size.width)} x ${Math.round(size.height)} PNG`;
    setStatus(svgStatus, "转换完成。");
  } finally {
    URL.revokeObjectURL(sourceSvgUrl);
  }
}

async function convertImageFile(file) {
  if (!file || !file.type.startsWith("image/") || file.type.includes("svg")) {
    throw new Error("请上传 PNG、JPG、WebP、BMP 或 GIF 图片。");
  }

  resetImageToSvgResult();
  setStatus(imageStatus, "正在读取图片并透明化白色区域...");

  const imageSourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageSourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const tolerance = Number(whiteTolerance.value);
    let transparentPixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];

      if (alpha > 0 && red >= 255 - tolerance && green >= 255 - tolerance && blue >= 255 - tolerance) {
        data[index + 3] = 0;
        transparentPixels += 1;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const transparentPng = canvas.toDataURL("image/png");
    const svgText = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`,
      `<title>${escapeXml(file.name)} converted with white transparency</title>`,
      `<image href="${transparentPng}" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="xMidYMid meet"/>`,
      "</svg>",
    ].join("");

    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    svgUrl = URL.createObjectURL(blob);
    svgDownloadName = getOutputName(file.name, ".svg");
    svgPreview.src = svgUrl;
    svgPreview.classList.add("ready");
    svgEmptyPreview.hidden = true;
    svgDownloadBtn.disabled = false;
    imageFileMeta.textContent = `${file.name} -> ${canvas.width} x ${canvas.height} SVG，透明化 ${transparentPixels} 个像素`;
    setStatus(imageStatus, "转换完成。");
  } finally {
    URL.revokeObjectURL(imageSourceUrl);
  }
}

async function handleSvgFile(file) {
  try {
    await convertSvgFile(file);
  } catch (error) {
    resetSvgToPngResult();
    setStatus(svgStatus, error.message || "转换失败。", true);
  }
}

async function handleImageFile(file) {
  lastImageFile = file || lastImageFile;

  try {
    await convertImageFile(lastImageFile);
  } catch (error) {
    resetImageToSvgResult();
    setStatus(imageStatus, error.message || "转换失败。", true);
  }
}

function bindDropUpload(dropZone, fileInput, handler) {
  fileInput.addEventListener("change", () => {
    const [file] = fileInput.files;
    handler(file);
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
    handler(file);
  });
}

function bindDownload(button, getUrl, getName) {
  button.addEventListener("click", () => {
    const url = getUrl();
    if (!url) {
      return;
    }

    const link = document.createElement("a");
    link.href = url;
    link.download = getName();
    document.body.append(link);
    link.click();
    link.remove();
  });
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const panelId = button.dataset.panel;

    tabButtons.forEach((tab) => {
      const isActive = tab === button;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    panels.forEach((panel) => {
      const isActive = panel.id === panelId;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
    });
  });
});

whiteTolerance.addEventListener("input", () => {
  whiteToleranceValue.textContent = whiteTolerance.value;
});

whiteTolerance.addEventListener("change", () => {
  if (lastImageFile) {
    handleImageFile(lastImageFile);
  }
});

bindDropUpload(svgDropZone, svgFileInput, handleSvgFile);
bindDropUpload(imageDropZone, imageFileInput, handleImageFile);
bindDownload(pngDownloadBtn, () => pngUrl, () => pngDownloadName);
bindDownload(svgDownloadBtn, () => svgUrl, () => svgDownloadName);
