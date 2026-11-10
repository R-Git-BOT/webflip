export type Point = [number, number];

export type StrokeOperation = {
  kind: "stroke";
  points: Point[];
};

export type ClearOperation = {
  kind: "clear";
};

export type DrawingOperation = StrokeOperation | ClearOperation;

export type DrawingHistoryState = {
  operations: DrawingOperation[];
  canUndo: boolean;
  canRedo: boolean;
};

export type DrawingHistory = {
  addStroke(points: Point[]): void;
  clear(): void;
  undo(): void;
  redo(): void;
  getState(): DrawingHistoryState;
};

export function createDrawingHistory(): DrawingHistory {
  const operations: DrawingOperation[] = [];
  const redoStack: DrawingOperation[] = [];

  return {
    addStroke(points) {
      operations.push({ kind: "stroke", points: structuredClone(points) });
      redoStack.length = 0;
    },
    clear() {
      operations.push({ kind: "clear" });
      redoStack.length = 0;
    },
    undo() {
      const operation = operations.pop();
      if (operation) redoStack.push(operation);
    },
    redo() {
      const operation = redoStack.pop();
      if (operation) operations.push(operation);
    },
    getState() {
      return {
        operations: structuredClone(operations),
        canUndo: operations.length > 0,
        canRedo: redoStack.length > 0
      };
    }
  };
}
