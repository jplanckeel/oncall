import React, { createContext, useCallback, useContext, useMemo } from 'react';

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Timeline } from 'components/Timeline/Timeline';

/**
 * Vertical drag-and-drop list built on @dnd-kit.
 *
 * It replaces `react-sortable-hoc`, which is unmaintained and relies on `ReactDOM.findDOMNode` — removed in
 * React 19 (Grafana 12.3), where it throws and takes down whatever screen renders it. Unlike
 * react-transition-group, that library exposes no `nodeRef` escape hatch, so the only fix is to drop it.
 *
 * The `onSortEnd({ oldIndex, newIndex })` callback keeps react-sortable-hoc's signature so existing store
 * actions (`moveEscalationPolicyToPosition`, `moveNotificationPolicyToPosition`) work unchanged. Indices are
 * relative to `items`, i.e. to the sortable children only — non-sortable children (headers, "add step" rows)
 * are rendered as-is and never counted.
 */

interface SortableItemContextValue {
  attributes: React.HTMLAttributes<HTMLElement>;
  listeners: Record<string, Function>;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  isDisabled: boolean;
}

const SortableItemContext = createContext<SortableItemContextValue | undefined>(undefined);

/**
 * Consumed by drag handles so only the handle starts a drag (react-sortable-hoc's `useDragHandle` +
 * `SortableHandle`). Returns undefined when rendered outside a `<SortableItem>`, in which case the handle
 * should render as a plain, inert element.
 */
export const useSortableItem = () => useContext(SortableItemContext);

interface SortableItemProps {
  id: UniqueIdentifier;
  disabled?: boolean;
  /** Must accept `innerRef` / `style` and apply them to its root DOM node (e.g. `Timeline.Item`). */
  children: React.ReactElement<{ innerRef?: React.Ref<HTMLElement>; style?: React.CSSProperties }>;
}

export const SortableItem: React.FC<SortableItemProps> = ({ id, disabled, children }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const context = useMemo<SortableItemContextValue>(
    () => ({ attributes, listeners, setActivatorNodeRef, isDisabled: Boolean(disabled) }),
    [attributes, listeners, setActivatorNodeRef, disabled]
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // lift the dragged row above its siblings, otherwise later items paint over it
    ...(isDragging ? { position: 'relative', zIndex: 1 } : {}),
  };

  return (
    <SortableItemContext.Provider value={context}>
      {React.cloneElement(children, { innerRef: setNodeRef, style })}
    </SortableItemContext.Provider>
  );
};

interface SortableListProps {
  className?: string;
  /** Stable ids of the sortable children, in render order. */
  items: UniqueIdentifier[];
  onSortEnd: (params: { oldIndex: number; newIndex: number }) => void;
  children: React.ReactNode;
}

export const SortableList: React.FC<SortableListProps> = ({ className, items, onSortEnd, children }) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = items.indexOf(active.id);
      const newIndex = items.indexOf(over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      onSortEnd({ oldIndex, newIndex });
    },
    [items, onSortEnd]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <Timeline className={className}>{children}</Timeline>
      </SortableContext>
    </DndContext>
  );
};
