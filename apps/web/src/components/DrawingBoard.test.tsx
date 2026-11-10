import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DrawingBoard } from "./DrawingBoard";

describe("DrawingBoard", () => {
  it("renders a blue canvas with the fixed white-pen controls and confirmation action", () => {
    const html = renderToStaticMarkup(
      <DrawingBoard confirmed={false} disabled={false} onConfirm={() => undefined} onReopen={() => undefined} />
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(html).toContain('aria-label="青いキャンバス。白いペンで回答を描きます"');
    expect(text).toContain("元に戻す");
    expect(text).toContain("やり直す");
    expect(text).toContain("全消し");
    expect(text).toContain("回答を確定");
  });
});
