import React from 'react';

import { cx } from '@emotion/css';
import { Icon, useStyles2 } from '@grafana/ui';
import { bem } from 'styles/utils.styles';

import { useSortableItem } from 'components/SortableList/SortableList';

import { getPolicyStyles } from './Policy.styles';

/**
 * Grab area of a `<SortableItem>` row. Replaces react-sortable-hoc's `SortableHandle` HOC, which broke under
 * React 19 (`ReactDOM.findDOMNode` removal) — see `SortableList`.
 */
export const DragHandle = ({ disabled }: { disabled?: boolean }) => {
  const styles = useStyles2(getPolicyStyles);
  const sortableItem = useSortableItem();

  const isDisabled = disabled || !sortableItem || sortableItem.isDisabled;

  return (
    <div
      ref={isDisabled ? undefined : sortableItem?.setActivatorNodeRef}
      className={cx(styles.control, styles.handle, { [bem(styles.handle, 'disabled')]: isDisabled })}
      {...(isDisabled ? {} : sortableItem.attributes)}
      {...(isDisabled ? {} : sortableItem.listeners)}
    >
      <Icon name="draggabledots" />
    </div>
  );
};
