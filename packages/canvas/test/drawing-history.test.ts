import { describe, expect, it } from "vitest";
import { createDrawingHistory } from "../src/index";

describe("DrawingHistory", () => {
  it("restores redo operations from a saved drawing history", () => {
    const history = createDrawingHistory();
    history.addStroke([[10,20], [30,40]]);
    history.undo();
    const restored = createDrawingHistory(history.exportState());
    restored.redo();
    expect(restored.getState().operations).toEqual([{ kind: "stroke", points: [[10,20], [30,40]] }]);
  });
  it("restores the latest stroke with undo and redo", () => {
    const history = createDrawingHistory();
    history.addStroke([[10, 20], [30, 40]]);
    history.addStroke([[50, 60], [70, 80]]);

    history.undo();
    expect(history.getState()).toEqual({
      operations: [{ kind: "stroke", points: [[10, 20], [30, 40]] }],
      canUndo: true,
      canRedo: true
    });

    history.redo();
    expect(history.getState()).toEqual({
      operations: [
        { kind: "stroke", points: [[10, 20], [30, 40]] },
        { kind: "stroke", points: [[50, 60], [70, 80]] }
      ],
      canUndo: true,
      canRedo: false
    });
  });

  it("treats clear as an undoable drawing operation", () => {
    const history = createDrawingHistory();
    history.addStroke([[10, 20], [30, 40]]);

    history.clear();
    expect(history.getState().operations).toEqual([
      { kind: "stroke", points: [[10, 20], [30, 40]] },
      { kind: "clear" }
    ]);

    history.undo();
    expect(history.getState().operations).toEqual([
      { kind: "stroke", points: [[10, 20], [30, 40]] }
    ]);
  });
});
