import { useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';

interface Column { key: string; label: string }

function Card<T extends { id: string }>({ item, render, onOpen }: { item: T; render: (i: T) => ReactNode; onOpen?: (i: T) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  return (
    <div ref={setNodeRef} className={`kanban-card ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners}
      onClick={() => onOpen?.(item)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(item); }}>
      {render(item)}
    </div>
  );
}

function Col({ col, count, children, footer }: { col: Column; count: number; children: ReactNode; footer?: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <section ref={setNodeRef} className={`kanban-col ${isOver ? 'over' : ''}`} aria-label={col.label}>
      <div className="kanban-col-head"><h3 style={{ fontSize: 14 }}>{col.label}</h3><span className="badge">{count}</span></div>
      {children}
      {footer}
    </section>
  );
}

/** Tablero Kanban con arrastre táctil (mantén pulsado) y con ratón o teclado. */
export function Kanban<T extends { id: string }>({ columns, items, columnOf, onMove, renderCard, onOpen, columnFooter }: {
  columns: Column[]; items: T[]; columnOf: (i: T) => string; onMove: (item: T, column: string) => void;
  renderCard: (i: T) => ReactNode; onOpen?: (i: T) => void; columnFooter?: (col: Column) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [active, setActive] = useState<T | null>(null);
  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const item = items.find((i) => i.id === e.active.id);
    const to = e.over?.id as string | undefined;
    if (item && to && to !== columnOf(item)) onMove(item, to);
  };
  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActive(items.find((i) => i.id === e.active.id) ?? null)} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
      <div className="kanban">
        {columns.map((c) => {
          const list = items.filter((i) => columnOf(i) === c.key);
          return (
            <Col key={c.key} col={c} count={list.length} footer={columnFooter?.(c)}>
              {list.map((i) => <Card key={i.id} item={i} render={renderCard} onOpen={onOpen} />)}
            </Col>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <div className="kanban-card overlay-card">{renderCard(active)}</div> : null}</DragOverlay>
    </DndContext>
  );
}
