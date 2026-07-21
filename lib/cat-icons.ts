import {
  UtensilsCrossed,
  Cake,
  ShoppingCart,
  Pill,
  Wrench,
  Zap,
  Scissors,
  Shirt,
  Store,
} from "lucide-react";

export const CAT_ICON: Record<string, typeof Cake> = {
  "cat.restaurants": UtensilsCrossed,
  "cat.sweets": Cake,
  "cat.grocery": ShoppingCart,
  "cat.pharmacy": Pill,
  "cat.plumber": Wrench,
  "cat.electrician": Zap,
  "cat.beauty": Scissors,
  "cat.laundry": Shirt,
};

export const catIcon = (key: string) => CAT_ICON[key] ?? Store;

export const CAT_KEYS = [
  "cat.restaurants",
  "cat.sweets",
  "cat.grocery",
  "cat.pharmacy",
  "cat.plumber",
  "cat.electrician",
  "cat.beauty",
  "cat.laundry",
];
