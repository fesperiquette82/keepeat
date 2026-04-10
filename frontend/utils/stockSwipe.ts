export function resolveSwipeAction(direction: 'left' | 'right'): 'used' | 'thrown' {
  return direction === 'left' ? 'used' : 'thrown';
}
