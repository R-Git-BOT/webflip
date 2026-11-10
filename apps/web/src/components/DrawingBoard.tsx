import React, { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CheckCircle,
  PencilSimple,
  Trash
} from "@phosphor-icons/react";
import {
  createDrawingHistory,
  type DrawingHistory,
  type DrawingOperation,
  type Point
} from "@webflipper/canvas";

type DrawingBoardProps = {
  confirmed: boolean;
  disabled: boolean;
  initialOperations?: DrawingOperation[];
  initialRedoOperations?: DrawingOperation[];
  onConfirm(drawing: { operations: DrawingOperation[]; redoOperations: DrawingOperation[]; pngDataUrl: string }): void;
  onReopen(): void;
  onDraftChange?(drawing: { operations: DrawingOperation[]; redoOperations: DrawingOperation[]; pngDataUrl: string }): void;
};

function drawOperations(context: CanvasRenderingContext2D, operations: DrawingOperation[]) {
  context.fillStyle = "#0868d9";
  context.fillRect(0, 0, 1024, 768);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 8;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const operation of operations) {
    if (operation.kind === "clear") {
      context.fillRect(0, 0, 1024, 768);
      continue;
    }
    if (operation.points.length === 0) continue;
    context.beginPath();
    context.moveTo(operation.points[0]?.[0] ?? 0, operation.points[0]?.[1] ?? 0);
    for (const point of operation.points.slice(1)) context.lineTo(point[0], point[1]);
    context.stroke();
  }
}

export function DrawingBoard({
  confirmed,
  disabled,
  initialOperations = [],
  initialRedoOperations = [],
  onConfirm,
  onReopen,
  onDraftChange
}: DrawingBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<DrawingHistory | null>(null);
  const activePointsRef = useRef<Point[] | null>(null);
  const [revision, setRevision] = useState(0);
  const onDraftRef = useRef(onDraftChange);
  onDraftRef.current = onDraftChange;

  if (historyRef.current === null) {
    const history = createDrawingHistory({ operations: initialOperations, redoOperations: initialRedoOperations });
    historyRef.current = history;
  }

  const state = historyRef.current.getState();
  function exportDrawing() {
    if (!historyRef.current || !canvasRef.current) return null;
    return { ...historyRef.current.exportState(), pngDataUrl: canvasRef.current.toDataURL("image/png") };
  }

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (context) drawOperations(context, historyRef.current?.getState().operations ?? []);
  }, [revision]);

  useEffect(() => {
    if (!onDraftRef.current || confirmed || disabled || revision === 0) return;
    const timeout = window.setTimeout(() => {
      const drawing = exportDrawing();
      if (drawing) onDraftRef.current?.(drawing);
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [confirmed, disabled, revision]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) / bounds.width) * 1024,
      ((event.clientY - bounds.top) / bounds.height) * 768
    ];
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || confirmed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointsRef.current = [pointFromEvent(event)];
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const activePoints = activePointsRef.current;
    if (!activePoints || disabled || confirmed) return;
    const nextPoint = pointFromEvent(event);
    const previousPoint = activePoints.at(-1);
    activePoints.push(nextPoint);
    const context = event.currentTarget.getContext("2d");
    if (!context || !previousPoint) return;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(previousPoint[0], previousPoint[1]);
    context.lineTo(nextPoint[0], nextPoint[1]);
    context.stroke();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const points = activePointsRef.current;
    activePointsRef.current = null;
    if (!points || points.length === 0 || disabled || confirmed) return;
    historyRef.current?.addStroke(points);
    event.currentTarget.releasePointerCapture(event.pointerId);
    setRevision((value) => value + 1);
  }

  function updateHistory(action: (history: DrawingHistory) => void) {
    if (disabled || confirmed || !historyRef.current) return;
    action(historyRef.current);
    setRevision((value) => value + 1);
  }

  return (
    <section className={`drawing-board ${confirmed || disabled ? "drawing-board--locked" : ""}`}>
      <div className="canvas-frame">
        <canvas
          ref={canvasRef}
          width={1024}
          height={768}
          aria-label="青いキャンバス。白いペンで回答を描きます"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        {disabled ? <div className="canvas-lock">接続を確認しています</div> : null}
        {confirmed ? <div className="canvas-lock">回答を確定しました</div> : null}
      </div>
      <div className="drawing-toolbar" aria-label="描画ツール">
        <button type="button" disabled={!state.canUndo || confirmed || disabled} onClick={() => updateHistory((history) => history.undo())}>
          <ArrowCounterClockwise aria-hidden="true" size={25} />元に戻す
        </button>
        <button type="button" disabled={!state.canRedo || confirmed || disabled} onClick={() => updateHistory((history) => history.redo())}>
          <ArrowClockwise aria-hidden="true" size={25} />やり直す
        </button>
        <button type="button" disabled={confirmed || disabled} onClick={() => updateHistory((history) => history.clear())}>
          <Trash aria-hidden="true" size={25} />全消し
        </button>
      </div>
      {confirmed ? (
        <button className="button button--primary answer-action" type="button" disabled={disabled} onClick={onReopen}>
          <PencilSimple aria-hidden="true" size={28} />編集する
        </button>
      ) : (
        <button
          className="button button--primary answer-action"
          type="button"
          disabled={disabled}
          onClick={() => { const drawing = exportDrawing(); if (drawing) onConfirm(drawing); }}
        >
          <CheckCircle aria-hidden="true" size={28} />回答を確定
        </button>
      )}
    </section>
  );
}
