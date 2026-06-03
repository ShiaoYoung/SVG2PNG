const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tool-panel");

const svgDropZone = document.querySelector("#svgDropZone");
const svgFileInput = document.querySelector("#svgFileInput");
const svgStatus = document.querySelector("#svgStatus");
const pngPreview = document.querySelector("#pngPreview");
const pngEmptyPreview = document.querySelector("#pngEmptyPreview");
const pngDownloadBtn = document.querySelector("#pngDownloadBtn");
const pngRotateLeftBtn = document.querySelector("#pngRotateLeftBtn");
const pngRotateRightBtn = document.querySelector("#pngRotateRightBtn");
const svgFileMeta = document.querySelector("#svgFileMeta");

const imageDropZone = document.querySelector("#imageDropZone");
const imageFileInput = document.querySelector("#imageFileInput");
const imageStatus = document.querySelector("#imageStatus");
const svgPreview = document.querySelector("#svgPreview");
const svgEmptyPreview = document.querySelector("#svgEmptyPreview");
const svgDownloadBtn = document.querySelector("#svgDownloadBtn");
const svgRotateLeftBtn = document.querySelector("#svgRotateLeftBtn");
const svgRotateRightBtn = document.querySelector("#svgRotateRightBtn");
const imageFileMeta = document.querySelector("#imageFileMeta");
const whiteTolerance = document.querySelector("#whiteTolerance");
const whiteToleranceValue = document.querySelector("#whiteToleranceValue");

const docDropZone = document.querySelector("#docDropZone");
const docFileInput = document.querySelector("#docFileInput");
const docStatus = document.querySelector("#docStatus");
const jpgPreview = document.querySelector("#jpgPreview");
const jpgEmptyPreview = document.querySelector("#jpgEmptyPreview");
const jpgDownloadBtn = document.querySelector("#jpgDownloadBtn");
const jpgRotateLeftBtn = document.querySelector("#jpgRotateLeftBtn");
const jpgRotateRightBtn = document.querySelector("#jpgRotateRightBtn");
const docFileMeta = document.querySelector("#docFileMeta");
const backgroundStrength = document.querySelector("#backgroundStrength");
const backgroundStrengthValue = document.querySelector("#backgroundStrengthValue");

let lastImageFile = null;
let lastDocFile = null;

const SVG_PNG_EXPORT_SCALE = 16;
const SVG_PNG_MAX_DIMENSION = 32767;
const SVG_PNG_MAX_PIXELS = 268435456;

const outputs = {
  png: createOutputState({
    extension: ".png",
    mime: "image/png",
    preview: pngPreview,
    empty: pngEmptyPreview,
    meta: svgFileMeta,
    download: pngDownloadBtn,
    rotateLeft: pngRotateLeftBtn,
    rotateRight: pngRotateRightBtn,
    transparent: true,
  }),
  svg: createOutputState({
    extension: ".svg",
    mime: "image/svg+xml;charset=utf-8",
    preview: svgPreview,
    empty: svgEmptyPreview,
    meta: imageFileMeta,
    download: svgDownloadBtn,
    rotateLeft: svgRotateLeftBtn,
    rotateRight: svgRotateRightBtn,
    transparent: true,
  }),
  jpg: createOutputState({
    extension: ".jpg",
    mime: "image/jpeg",
    preview: jpgPreview,
    empty: jpgEmptyPreview,
    meta: docFileMeta,
    download: jpgDownloadBtn,
    rotateLeft: jpgRotateLeftBtn,
    rotateRight: jpgRotateRightBtn,
    transparent: false,
  }),
};

function createOutputState(config) {
  return {
    ...config,
    url: "",
    baseCanvas: null,
    fileName: "converted" + config.extension,
    rotation: 0,
    description: "",
  };
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function revokeUrl(url) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function setButtonsEnabled(output, enabled) {
  output.download.disabled = !enabled;
  output.rotateLeft.disabled = !enabled;
  output.rotateRight.disabled = !enabled;
}

function resetOutput(output, emptyText) {
  revokeUrl(output.url);
  output.url = "";
  output.baseCanvas = null;
  output.rotation = 0;
  output.preview.removeAttribute("src");
  output.preview.classList.remove("ready");
  output.empty.hidden = false;
  output.meta.textContent = emptyText;
  setButtonsEnabled(output, false);
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

  const match = String(value)
    .trim()
    .match(/^([\d.]+)\s*([a-z%]*)$/i);

  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitScale = {
    "": 1,
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
  };

  return amount * (unitScale[unit] || 1);
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

function getSvgPngExportScale(size) {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const maxDimensionScale = SVG_PNG_MAX_DIMENSION / Math.max(width, height);
  const maxPixelsScale = Math.sqrt(SVG_PNG_MAX_PIXELS / (width * height));
  const safeScale = Math.min(SVG_PNG_EXPORT_SCALE, maxDimensionScale, maxPixelsScale);

  return Math.max(1, safeScale);
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

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("图片生成失败。"));
        }
      },
      type,
      quality,
    );
  });
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return canvas;
}

function drawRotatedCanvas(source, rotation, transparent) {
  const normalized = ((rotation % 360) + 360) % 360;
  const swapped = normalized === 90 || normalized === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? source.height : source.width;
  canvas.height = swapped ? source.width : source.height;

  const ctx = canvas.getContext("2d");
  if (!transparent) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normalized * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

async function renderRasterOutput(output) {
  const canvas = drawRotatedCanvas(output.baseCanvas, output.rotation, output.transparent);
  const blob = await canvasToBlob(canvas, output.mime, output.mime === "image/jpeg" ? 0.94 : undefined);
  revokeUrl(output.url);
  output.url = URL.createObjectURL(blob);
  output.preview.src = output.url;
  output.preview.classList.add("ready");
  output.empty.hidden = true;
  setButtonsEnabled(output, true);
  output.meta.textContent = `${output.description} -> ${canvas.width} x ${canvas.height} ${output.extension.slice(1).toUpperCase()}`;
}

async function renderSvgOutput(output) {
  const canvas = drawRotatedCanvas(output.baseCanvas, output.rotation, true);
  const pngDataUrl = canvas.toDataURL("image/png");
  const svgText = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`,
    `<title>${escapeXml(output.description)} converted with white transparency</title>`,
    `<image href="${pngDataUrl}" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="xMidYMid meet"/>`,
    "</svg>",
  ].join("");
  const blob = new Blob([svgText], { type: output.mime });

  revokeUrl(output.url);
  output.url = URL.createObjectURL(blob);
  output.preview.src = output.url;
  output.preview.classList.add("ready");
  output.empty.hidden = true;
  setButtonsEnabled(output, true);
  output.meta.textContent = `${output.description} -> ${canvas.width} x ${canvas.height} SVG`;
}

async function rotateOutput(output, delta) {
  if (!output.baseCanvas) {
    return;
  }

  output.rotation = (output.rotation + delta + 360) % 360;
  if (output.extension === ".svg") {
    await renderSvgOutput(output);
  } else {
    await renderRasterOutput(output);
  }
}

async function setRasterOutput(output, canvas, fileName, description) {
  output.baseCanvas = cloneCanvas(canvas);
  output.rotation = 0;
  output.fileName = getOutputName(fileName, output.extension);
  output.description = description || fileName;
  await renderRasterOutput(output);
}

async function setSvgOutput(output, canvas, fileName, description) {
  output.baseCanvas = cloneCanvas(canvas);
  output.rotation = 0;
  output.fileName = getOutputName(fileName, ".svg");
  output.description = description || fileName;
  await renderSvgOutput(output);
}

async function convertSvgFile(file) {
  if (!file || (!file.type.includes("svg") && !/\.svg$/i.test(file.name))) {
    throw new Error("请上传 .svg 文件。");
  }

  resetOutput(outputs.png, "尚未生成图片");
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
    const exportScale = getSvgPngExportScale(size);
    const outputWidth = Math.max(1, Math.round(size.width * exportScale));
    const outputHeight = Math.max(1, Math.round(size.height * exportScale));
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, outputWidth, outputHeight);
    ctx.drawImage(image, 0, 0, outputWidth, outputHeight);

    await setRasterOutput(outputs.png, canvas, file.name, `${file.name}，高清 ${exportScale.toFixed(2)}x`);
    setStatus(svgStatus, "转换完成。");
  } finally {
    URL.revokeObjectURL(sourceSvgUrl);
  }
}

async function imageFileToCanvas(file) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function makeWhiteTransparent(canvas, tolerance) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
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
  return transparentPixels;
}

async function convertImageFile(file) {
  if (!file || !file.type.startsWith("image/") || file.type.includes("svg")) {
    throw new Error("请上传 PNG、JPG、WebP、BMP 或 GIF 图片。");
  }

  resetOutput(outputs.svg, "尚未生成 SVG");
  setStatus(imageStatus, "正在读取图片并透明化白色区域...");

  const canvas = await imageFileToCanvas(file);
  const transparentPixels = makeWhiteTransparent(canvas, Number(whiteTolerance.value));
  await setSvgOutput(outputs.svg, canvas, file.name, `${file.name}，透明化 ${transparentPixels} 个像素`);
  setStatus(imageStatus, "转换完成。");
}

function cleanDocumentBackground(canvas, strength) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const threshold = 150 - Math.round(strength * 0.45);
  const saturationLimit = 46 + Math.round(strength * 0.34);
  let whitenedPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max - min;
    const brightness = (red + green + blue) / 3;

    if (brightness >= threshold && saturation <= saturationLimit) {
      const mix = Math.min(1, 0.55 + strength / 140);
      data[index] = Math.round(red + (255 - red) * mix);
      data[index + 1] = Math.round(green + (255 - green) * mix);
      data[index + 2] = Math.round(blue + (255 - blue) * mix);
      whitenedPixels += 1;
    } else {
      const contrast = 1.04 + strength / 500;
      data[index] = clampColor((red - 128) * contrast + 128);
      data[index + 1] = clampColor((green - 128) * contrast + 128);
      data[index + 2] = clampColor((blue - 128) * contrast + 128);
    }

    data[index + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return whitenedPixels;
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function recognizeDocumentPage(file) {
  if (!file || !file.type.startsWith("image/") || file.type.includes("svg")) {
    throw new Error("请上传 PNG、JPG、WebP、BMP 或 GIF 文档照片。");
  }

  resetOutput(outputs.jpg, "尚未生成 JPG");
  setStatus(docStatus, "正在识别页面并净化背景...");

  const canvas = await imageFileToCanvas(file);
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "source-over";

  const whitenedPixels = cleanDocumentBackground(canvas, Number(backgroundStrength.value));
  await setRasterOutput(outputs.jpg, canvas, file.name, `${file.name}，白底化 ${whitenedPixels} 个像素`);
  setStatus(docStatus, "处理完成。");
}

async function handleSvgFile(file) {
  try {
    await convertSvgFile(file);
  } catch (error) {
    resetOutput(outputs.png, "尚未生成图片");
    setStatus(svgStatus, error.message || "转换失败。", true);
  }
}

async function handleImageFile(file) {
  lastImageFile = file || lastImageFile;

  try {
    await convertImageFile(lastImageFile);
  } catch (error) {
    resetOutput(outputs.svg, "尚未生成 SVG");
    setStatus(imageStatus, error.message || "转换失败。", true);
  }
}

async function handleDocFile(file) {
  lastDocFile = file || lastDocFile;

  try {
    await recognizeDocumentPage(lastDocFile);
  } catch (error) {
    resetOutput(outputs.jpg, "尚未生成 JPG");
    setStatus(docStatus, error.message || "处理失败。", true);
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

function bindDownload(output) {
  output.download.addEventListener("click", () => {
    if (!output.url) {
      return;
    }

    const link = document.createElement("a");
    link.href = output.url;
    link.download = output.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  });
}

function bindRotation(output) {
  output.rotateLeft.addEventListener("click", () => rotateOutput(output, -90));
  output.rotateRight.addEventListener("click", () => rotateOutput(output, 90));
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

backgroundStrength.addEventListener("input", () => {
  backgroundStrengthValue.textContent = backgroundStrength.value;
});

backgroundStrength.addEventListener("change", () => {
  if (lastDocFile) {
    handleDocFile(lastDocFile);
  }
});

bindDropUpload(svgDropZone, svgFileInput, handleSvgFile);
bindDropUpload(imageDropZone, imageFileInput, handleImageFile);
bindDropUpload(docDropZone, docFileInput, handleDocFile);

Object.values(outputs).forEach((output) => {
  bindDownload(output);
  bindRotation(output);
});
