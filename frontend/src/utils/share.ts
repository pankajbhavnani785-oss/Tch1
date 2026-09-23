import { Platform, Share } from "react-native";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";

const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

function stripBase64(image: string): string {
  return image?.startsWith("data:") ? image.split(",")[1] || "" : image || "";
}

function slug(text: string): string {
  return (text || "tch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tch";
}

async function writeTempImage(base64: string, name: string): Promise<string | null> {
  try {
    const payload = stripBase64(base64);
    if (!payload || payload.length < 500) return null;
    const path = `${FileSystem.cacheDirectory}${slug(name)}-${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(path, payload, { encoding: FileSystem.EncodingType.Base64 });
    return path;
  } catch {
    return null;
  }
}

type ShareProduct = { name: string; description?: string; price: number; mrp?: number; images?: string[] };

export async function shareProduct(product: ShareProduct): Promise<void> {
  const priceLine = product.mrp && product.mrp > product.price
    ? `Price: ${money(product.price)}  (MRP ${money(product.mrp)})`
    : `Price: ${money(product.price)}`;
  const message = [
    `✨ ${product.name} — TCH Kitchenware`,
    product.description ? product.description : "",
    priceLine,
    "",
    "Shop on TCH Kitchenware. Cash on Delivery available across India.",
  ].filter(Boolean).join("\n");

  const image = product.images?.[0];
  if (image) {
    const uri = await writeTempImage(image, product.name);
    if (uri && (await Sharing.isAvailableAsync())) {
      try {
        await Sharing.shareAsync(uri, { dialogTitle: `Share ${product.name}`, mimeType: "image/jpeg", UTI: "public.jpeg" });
        return;
      } catch {
        // fall through to text share
      }
    }
  }
  await Share.share(Platform.OS === "ios" ? { message, title: product.name } : { message, title: product.name });
}

type ShareCategory = { name: string; product_count?: number };

export async function shareCategory(category: ShareCategory): Promise<void> {
  const count = category.product_count ?? 0;
  const message = [
    `📦 ${category.name} — TCH Kitchenware`,
    count ? `Explore ${count} beautiful pieces in ${category.name}.` : `Explore beautiful pieces in ${category.name}.`,
    "",
    "Shop on TCH Kitchenware. Cash on Delivery available across India.",
  ].join("\n");
  await Share.share({ message, title: category.name });
}
