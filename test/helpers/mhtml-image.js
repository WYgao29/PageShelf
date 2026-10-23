import { html } from "./fixture.js";

export const IMAGE_LOCATION = "https://images.example.test/picture.png?size=150&expires=123&signature=a%3D";
export const IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAI3CrcUAAAAASUVORK5CYII=";

export function mhtmlWithImage(title, body = '<img alt="归档图片" src="' + IMAGE_LOCATION.replaceAll("&", "&amp;") + '">' + "这是保存在网页归档中的图片与正文。".repeat(30)) {
  return [
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; boundary="image-fixture"',
    "",
    "--image-fixture",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "Content-Location: https://example.test/article",
    "",
    Buffer.from(html(title, body)).toString("base64"),
    "--image-fixture",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-Location: " + IMAGE_LOCATION,
    "",
    IMAGE_BASE64,
    "--image-fixture--",
    "",
  ].join("\r\n");
}
