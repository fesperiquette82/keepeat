import { format } from 'date-fns';

export interface PersistProductEditDeps<TProductUpdate> {
  itemId: string;
  updateItem: (itemId: string, updates: TProductUpdate) => Promise<unknown>;
  fetchStock: () => Promise<void>;
  updates: TProductUpdate;
}

export async function persistProductEdit<TProductUpdate>({
  itemId,
  updateItem,
  fetchStock,
  updates,
}: PersistProductEditDeps<TProductUpdate>): Promise<boolean> {
  const updatedItem = await updateItem(itemId, updates);
  if (!updatedItem) return false;
  await fetchStock();
  return true;
}

export function toApiExpiryDate(expiryDate: Date | null | undefined): string | undefined {
  if (!expiryDate) return undefined;
  return format(expiryDate, 'yyyy-MM-dd');
}
