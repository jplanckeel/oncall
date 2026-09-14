import React from 'react';

import { cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';

import { getTimelineStyles } from './Timeline.styles';

export interface TimelineItemProps {
  className?: string;
  contentClassName?: string;
  isDisabled?: boolean;
  backgroundClassName?: string;
  backgroundHexNumber?: string;
  textColor?: string;
  number?: number;
  badge?: number;
  children?: any;
  /** Set by `SortableItem` so @dnd-kit can measure and move this row. */
  innerRef?: React.Ref<HTMLElement>;
  /** Drag transform applied by `SortableItem`. */
  style?: React.CSSProperties;
}

export const TimelineItem: React.FC<TimelineItemProps> = ({
  className,
  contentClassName,
  children,
  isDisabled,
  backgroundClassName,
  backgroundHexNumber,
  textColor = '#ffffff',
  number,
  innerRef,
  style,
}) => {
  const styles = useStyles2(getTimelineStyles);

  return (
    <li ref={innerRef as React.Ref<HTMLLIElement>} style={style} className={cx(styles.item, className)}>
      {!isDisabled && (
        <div
          className={cx(styles.dot, backgroundClassName || '')}
          style={{ backgroundColor: backgroundHexNumber || '', color: textColor }}
        >
          {number}
        </div>
      )}
      <div className={cx(styles.content, contentClassName, { [styles.contentNoMargin]: isDisabled })}>{children}</div>
    </li>
  );
};
