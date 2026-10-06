import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
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
import { cx } from '@emotion/css';
import { Stack, IconButton, useStyles2 } from '@grafana/ui';
import { arrayMoveImmutable } from 'array-move';
import { UserActions } from 'helpers/authorization/authorization';
import { bem } from 'styles/utils.styles';

import { Text } from 'components/Text/Text';
import { RemoteSelect } from 'containers/RemoteSelect/RemoteSelect';
import { ApiSchemas } from 'network/oncall-api/api.types';

import { fromPlainArray, toPlainArray } from './UserGroups.helpers';
import { getUserGroupStyles } from './UserGroups.styles';
import { Item } from './UserGroups.types';

interface UserGroupsProps {
  value: Array<Array<ApiSchemas['User']['pk']>>;
  onChange: (value: Array<Array<ApiSchemas['User']['pk']>>) => void;
  isMultipleGroups: boolean;
  renderUser: (id: string) => React.ReactElement;
  showError?: boolean;
  disabled?: boolean;
}

export const UserGroups = (props: UserGroupsProps) => {
  const styles = useStyles2(getUserGroupStyles);
  const { value, onChange, isMultipleGroups, renderUser, showError, disabled } = props;

  const handleAddUserGroup = useCallback(() => {
    onChange([...value, []]);
  }, [value]);

  const handleDeleteUser = (index: number) => {
    const newGroups = [...value];
    let k = -1;
    for (let i = 0; i < value.length; i++) {
      k++;
      const users = value[i];
      for (let j = 0; j < users.length; j++) {
        k++;

        if (k === index) {
          newGroups[i] = newGroups[i].filter((_item, itemIndex) => itemIndex !== j);
          onChange(newGroups.filter((group) => group.length));
          return;
        }
      }
    }
  };

  const handleUserAdd = useCallback(
    (pk: ApiSchemas['User']['pk']) => {
      if (!pk) {
        return;
      }

      const newGroups = [...value];
      let lastGroup = newGroups[newGroups.length - 1];
      if (!isMultipleGroups || (lastGroup && !lastGroup.length)) {
        if (!lastGroup) {
          lastGroup = [];
          newGroups.push(lastGroup);
        }
        lastGroup.push(pk);
      } else {
        newGroups.push([pk]);
      }

      onChange(newGroups);
    },
    [value]
  );

  const items = useMemo(() => toPlainArray(value), [value]);

  const onSortEnd = useCallback(
    ({ oldIndex, newIndex }) => {
      const newPlainArray = arrayMoveImmutable(items, oldIndex, newIndex);

      onChange(fromPlainArray(newPlainArray, newIndex > items.length));
    },
    [items]
  );

  const getDeleteItemHandler = (index: number) => {
    return () => {
      handleDeleteUser(index);
    };
  };

  const renderItem = (item: Item, index: number, dragHandle: React.ReactNode) => (
    <>
      {renderUser(item.data)}
      {!disabled && (
        <div className={styles.userButtons}>
          <Stack>
            <IconButton
              aria-label="Remove"
              className={styles.icon}
              name="trash-alt"
              onClick={getDeleteItemHandler(index)}
            />
            {dragHandle}
          </Stack>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.root}>
      <Stack direction="column">
        {!disabled && (
          <RemoteSelect
            key={items.length}
            showSearch
            placeholder="Add user"
            href={`/users/?permission=${UserActions.NotificationsRead.permission}&filters=true`}
            value={null}
            onChange={handleUserAdd}
            showError={showError}
            maxMenuHeight={150}
            requiredUserAction={UserActions.UserSettingsWrite}
          />
        )}
        <SortableList
          renderItem={renderItem}
          items={items}
          onSortEnd={onSortEnd}
          handleAddGroup={handleAddUserGroup}
          isMultipleGroups={isMultipleGroups}
          allowCreate={!disabled}
          isDragDisabled={disabled}
        />
      </Stack>
    </div>
  );
};

interface SortableRowProps {
  id: string;
  className?: string;
  isDragDisabled?: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

/**
 * One draggable `<li>` of the group list. Replaces react-sortable-hoc's `SortableElement` + `SortableHandle`,
 * which rely on `ReactDOM.findDOMNode` — removed in React 19, where they throw on mount.
 *
 * Only the returned handle starts a drag (react-sortable-hoc's `useDragHandle` behaviour), so the row stays
 * clickable and the trash button keeps working.
 */
const SortableRow = ({ id, className, isDragDisabled, children }: SortableRowProps) => {
  const styles = useStyles2(getUserGroupStyles);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isDragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 1 } : {}),
  };

  const dragHandle = isDragDisabled ? null : (
    <IconButton
      aria-label="Drag"
      className={cx('icon')}
      name="draggabledots"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
    />
  );

  return (
    <li ref={setNodeRef} style={style} className={cx(className, { [styles.sortable]: isDragging })}>
      {children(dragHandle)}
    </li>
  );
};

interface SortableListProps {
  items: Item[];
  handleAddGroup: () => void;
  isMultipleGroups: boolean;
  renderItem: (item: Item, index: number, dragHandle: React.ReactNode) => React.ReactNode;
  onSortEnd: (params: { oldIndex: number; newIndex: number }) => void;
  allowCreate?: boolean;
  isDragDisabled?: boolean;
}

const SortableList = ({
  items,
  handleAddGroup,
  isMultipleGroups,
  renderItem,
  onSortEnd,
  allowCreate,
  isDragDisabled,
}: SortableListProps) => {
  const listRef = useRef<HTMLUListElement>();
  const styles = useStyles2(getUserGroupStyles);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // group separators are sortable too — moving one moves the group boundary
  const sortableIds = useMemo(
    () => items.filter((item) => item.type === 'item' || isMultipleGroups).map((item) => item.key),
    [items, isMultipleGroups]
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }

    // indices must address the full plain array, which is what `fromPlainArray` rebuilds the groups from
    const oldIndex = items.findIndex((item) => item.key === active.id);
    const newIndex = items.findIndex((item) => item.key === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    onSortEnd({ oldIndex, newIndex });
  };

  useEffect(() => {
    const container = listRef.current;

    container.scroll({
      left: 0,
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, [items]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className={styles.groups} ref={listRef}>
          {items.map((item, index) =>
            item.type === 'item' ? (
              <SortableRow key={item.key} id={item.key} className={styles.user} isDragDisabled={isDragDisabled}>
                {(dragHandle) => renderItem(item, index, dragHandle)}
              </SortableRow>
            ) : isMultipleGroups ? (
              <SortableRow key={item.key} id={item.key} className={styles.separator} isDragDisabled={isDragDisabled}>
                {() => <Text type="secondary">{item.data.name}</Text>}
              </SortableRow>
            ) : null
          )}
          {allowCreate && isMultipleGroups && items[items.length - 1]?.type === 'item' && (
            // not sortable: it is an action row, not a group
            <li
              key="New Group"
              onClick={handleAddGroup}
              className={cx(styles.separator, { [bem(styles.separator, 'clickable')]: true })}
            >
              <Text type="primary">+ Add user group</Text>
            </li>
          )}
        </ul>
      </SortableContext>
    </DndContext>
  );
};
