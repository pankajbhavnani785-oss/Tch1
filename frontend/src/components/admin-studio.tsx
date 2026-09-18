import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Asset } from "expo-asset";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { api, Category, DashboardStats, Order, Product, StockEvent, User } from "@/src/api";

type Props = { categories: Category[]; products: Product[]; orders: Order[]; onBack: () => void; refresh: () => Promise<void>; styles: any; colors: any };

const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const imageUri = (source?: string) => source ? (source.startsWith("data:") ? source : `data:image/jpeg;base64,${source}`) : "";

const APP_SHARE_MESSAGE = "🛍️ *TCH Kitchenware & Gifts* — Shop premium crockery, glassware and homeware with fast delivery across India. Cash on Delivery available. Download the TCH app and start shopping today!";

function normalizeMobile(mobile: string): string {
  const digits = (mobile || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function buildOrderMessage(order: Order): string {
  const lines: string[] = [];
  lines.push(`*TCH Kitchenware — Order Update*`);
  lines.push("");
  lines.push(`Hi ${order.customer_name || order.address?.full_name},`);
  lines.push(`Order ID: ${order.id}`);
  lines.push(`Status: ${order.status.toUpperCase()}`);
  lines.push(`Placed: ${new Date(order.created_at).toLocaleString("en-IN")}`);
  lines.push("");
  lines.push(`*Items*`);
  order.items.forEach((item) => lines.push(`• ${item.name} × ${item.quantity} — ${money(item.price * item.quantity)}`));
  lines.push("");
  lines.push(`Subtotal: ${money(order.subtotal)}`);
  if (order.delivery_charge) lines.push(`Delivery: ${money(order.delivery_charge)}`);
  if (order.discount) lines.push(`Discount: -${money(order.discount)}`);
  lines.push(`*Total: ${money(order.total)}*`);
  lines.push(`Payment: ${order.payment_method}`);
  lines.push("");
  if (order.address) {
    lines.push(`*Delivery to*`);
    lines.push(`${order.address.full_name}`);
    lines.push(`${order.address.address}${order.address.landmark ? `, ${order.address.landmark}` : ""}`);
    lines.push(`${order.address.city}, ${order.address.state} - ${order.address.pincode}`);
    lines.push(`Mobile: ${order.address.mobile}`);
  }
  lines.push("");
  lines.push(`Thank you for shopping with TCH.`);
  return lines.join("\n");
}

export function AdminStudio({ categories, products, orders, onBack, refresh, styles, colors }: Props) {
  const [tab, setTab] = useState("Dashboard");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [mrp, setMrp] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [material, setMaterial] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState("");
  const [selectedId, setSelectedId] = useState(products[0]?.id || "");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockNote, setStockNote] = useState("");
  const [history, setHistory] = useState<StockEvent[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<User[]>([]);
  const [userView, setUserView] = useState<"pending" | "approved">("pending");
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => { if (tab === "Dashboard") api.dashboardStats().then(setStats).catch(() => setStats(null)); }, [tab, orders, products]);

  useEffect(() => { if (!selectedId && products[0]) setSelectedId(products[0].id); }, [products, selectedId]);
  useEffect(() => { if (selectedId) api.stockHistory(selectedId).then(setHistory).catch(() => setHistory([])); }, [selectedId]);
  useEffect(() => {
    if (tab === "Users") {
      api.listUsers("pending").then(setPendingUsers).catch(() => setPendingUsers([]));
      api.listUsers("approved").then(setApprovedUsers).catch(() => setApprovedUsers([]));
    }
  }, [tab]);

  const chooseImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 4, quality: 0.75 });
    if (result.canceled) return;
    const encoded = await Promise.all(result.assets.slice(0, 4).map(async (asset) => {
      const blob = await fetch(asset.uri).then((response) => response.blob());
      return new Promise<string>((resolve) => { const reader = new FileReader(); reader.onloadend = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(blob); });
    }));
    setGalleryImages(encoded);
  };

  const addProduct = async () => {
    const urls = imageUrls.split(/[\s,]+/).filter((url) => url.length > 0);
    if (urls.some((url) => !url.startsWith("https://"))) { setMessage("Image links must start with https://"); return; }
    if (!name || !categoryId || !mrp || !price || !stock) { setMessage("Complete the product name, category, prices and stock."); return; }
    setBusy(true); setMessage("");
    try {
      await api.createProduct({ name, description, category_id: categoryId, mrp: Number(mrp), price: Number(price), stock: Number(stock), rating: 4.5, material, dimensions, images: [...galleryImages, ...urls].slice(0, 4) });
      setMessage("Product added. HTTPS images were converted to catalog-ready base64.");
      setName(""); setDescription(""); setMrp(""); setPrice(""); setStock(""); setMaterial(""); setDimensions(""); setGalleryImages([]); setImageUrls("");
      await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save product"); } finally { setBusy(false); }
  };

  const updateStock = async (operation: "add" | "set") => {
    if (!selectedId || !stockQuantity || Number(stockQuantity) < 1) { setMessage("Choose a product and enter a quantity first."); return; }
    setBusy(true); setMessage("");
    try { await api.updateStock(selectedId, Number(stockQuantity), operation, stockNote || (operation === "add" ? "Purchased stock" : "Manual stock correction")); setMessage(operation === "add" ? "Purchased quantity added to stock." : "Stock level updated."); setStockQuantity(""); setStockNote(""); await refresh(); setHistory(await api.stockHistory(selectedId)); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not update stock"); } finally { setBusy(false); }
  };

  const addCategory = async () => { if (!newCategory.trim()) return; try { await api.createCategory(newCategory.trim()); setNewCategory(""); setMessage("Category added."); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not add category"); } };

  const share = (order: Order) => {
    const text = encodeURIComponent(buildOrderMessage(order));
    const phone = normalizeMobile(order.address?.mobile || "");
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    Linking.openURL(url).catch(() => Alert.alert("WhatsApp unavailable", "Install WhatsApp to share this order."));
  };

  const shareAppImage = async () => {
    try {
      const asset = Asset.fromModule(require("../../assets/images/tch-promo.png"));
      await asset.downloadAsync();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare && asset.localUri) {
        await Sharing.shareAsync(asset.localUri, { dialogTitle: "Share TCH Kitchenware", mimeType: "image/png", UTI: "public.png" });
      } else {
        await Share.share({ message: APP_SHARE_MESSAGE });
      }
    } catch (e) {
      Alert.alert("Could not share", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const shareAppOnWhatsapp = () => {
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(APP_SHARE_MESSAGE)}`).catch(() => Alert.alert("WhatsApp unavailable", "Install WhatsApp to share the app."));
  };
  const remove = async (order: Order) => { try { await api.deleteOrder(order.id); await refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Only dispatched or cancelled orders can be deleted"); } };
  const deleteProduct = async (product: Product) => { try { await api.deleteProduct(product.id); await refresh(); setMessage(`${product.name} removed.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not remove product"); } };

  const approve = async (user: User) => { try { await api.approveUser(user.id); setPendingUsers(await api.listUsers("pending")); setApprovedUsers(await api.listUsers("approved")); setMessage(`${user.full_name} approved.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not approve"); } };
  const reject = async (user: User) => { try { await api.rejectUser(user.id); setPendingUsers(await api.listUsers("pending")); setMessage(`${user.full_name} rejected.`); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not reject"); } };
  const whatsappUser = (user: User) => {
    const identifier = user.identifier;
    const phone = /^\d+$/.test(identifier.replace(/\D/g, "")) && identifier.replace(/\D/g, "").length >= 10 ? normalizeMobile(identifier) : "";
    const text = encodeURIComponent(`Hi ${user.full_name}, your TCH Kitchenware account has been approved. You can now sign in and start shopping.`);
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    Linking.openURL(url).catch(() => {});
  };

  const selected = products.find((product) => product.id === selectedId);

  return <View style={styles.root}>
    <View style={styles.detailHeader}><Pressable style={styles.iconButton} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Admin Studio</Text><View style={styles.iconButton} /></View>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
        {["Dashboard", "Products", "Manage", "Stock", "Categories", "Users", "Orders"].map((item) => <Pressable testID={`admin-${item.toLowerCase()}`} key={item} style={[styles.filterPill, tab === item && styles.filterPillActive]} onPress={() => setTab(item)}><Text style={[styles.filterText, tab === item && styles.filterTextActive]}>{item}</Text></Pressable>)}
      </ScrollView>

      {tab === "Dashboard" ? <>
        <Text style={styles.pageTitle}>Sales snapshot</Text>
        <Text style={styles.pageSubtitle}>Today at a glance — orders, revenue and low stock.</Text>
        <View style={styles.statGrid}>
          <View style={[styles.statCard, { backgroundColor: colors.brandPrimary }]}><Ionicons name="cart-outline" size={22} color={colors.onBrandPrimary} /><Text style={styles.statValueLight}>{stats?.today_orders ?? 0}</Text><Text style={styles.statLabelLight}>Orders today</Text></View>
          <View style={[styles.statCard, { backgroundColor: colors.brandSecondary }]}><Ionicons name="cash-outline" size={22} color={colors.onBrandPrimary} /><Text style={styles.statValueLight}>{money(stats?.today_revenue ?? 0)}</Text><Text style={styles.statLabelLight}>Revenue today</Text></View>
          <View style={styles.statCardOutline}><Ionicons name="hourglass-outline" size={22} color={colors.warning} /><Text style={styles.statValue}>{stats?.active_orders ?? 0}</Text><Text style={styles.statLabel}>Processing</Text></View>
          <View style={styles.statCardOutline}><Ionicons name="checkmark-circle-outline" size={22} color={colors.success} /><Text style={styles.statValue}>{stats?.total_delivered ?? 0}</Text><Text style={styles.statLabel}>Delivered</Text></View>
          <View style={styles.statCardOutline}><Ionicons name="people-outline" size={22} color={colors.brandPrimary} /><Text style={styles.statValue}>{stats?.pending_users ?? 0}</Text><Text style={styles.statLabel}>Pending users</Text></View>
          <View style={styles.statCardOutline}><Ionicons name="storefront-outline" size={22} color={colors.brandPrimary} /><Text style={styles.statValue}>{stats?.total_products ?? 0}</Text><Text style={styles.statLabel}>Total products</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Low stock alerts</Text>
        {stats?.low_stock?.length ? stats.low_stock.map((product) => <View style={styles.listRow} key={product.id}>
          <Ionicons name={product.stock === 0 ? "alert-circle" : "warning-outline"} size={20} color={product.stock === 0 ? colors.error : colors.warning} />
          <Text style={styles.flexText} numberOfLines={1}>{product.name}</Text>
          <Text style={[styles.rating, { color: product.stock === 0 ? colors.error : colors.warning }]}>{product.stock === 0 ? "Out" : `${product.stock} left`}</Text>
        </View>) : <Text style={styles.muted}>All products are well stocked.</Text>}

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Promote TCH on WhatsApp</Text>
        <Text style={styles.pageSubtitle}>Share the app image with customers to bring them into the store.</Text>
        <View style={styles.promoCard}>
          <Image testID="app-promo-image" source={require("../../assets/images/tch-promo.png")} style={styles.promoImage} resizeMode="cover" />
          <Text style={styles.bold}>TCH Kitchenware & Gifts</Text>
          <Text style={styles.muted}>Send this promo card to customers on WhatsApp along with your invite message.</Text>
          <View style={styles.adminOrderActions}>
            <Pressable testID="share-app-image" style={styles.primaryButtonSmall} onPress={shareAppImage}><Ionicons name="share-social-outline" size={16} color={colors.onBrandPrimary} /><Text style={[styles.primaryButtonText, { marginLeft: 6 }]}>Share image</Text></Pressable>
            <Pressable testID="share-app-whatsapp" style={styles.secondaryButton} onPress={shareAppOnWhatsapp}><Ionicons name="logo-whatsapp" size={16} color={colors.brandPrimary} /><Text style={[styles.secondaryButtonText, { marginLeft: 6 }]}>WhatsApp text</Text></Pressable>
          </View>
        </View>
      </>
      : tab === "Products" ? <>
        <Text style={styles.pageTitle}>Add a product</Text>
        <Text style={styles.pageSubtitle}>Use gallery photos or paste up to four HTTPS image links.</Text>
        <Field testID="admin-product-name" label="Product name" value={name} onChangeText={setName} placeholder="Product name" styles={styles} colors={colors} />
        <Field label="Short description" value={description} onChangeText={setDescription} placeholder="Short description" styles={styles} colors={colors} />
        <Field label="MRP" value={mrp} onChangeText={setMrp} placeholder="MRP" keyboardType="numeric" styles={styles} colors={colors} />
        <Field label="Selling price" value={price} onChangeText={setPrice} placeholder="Selling price" keyboardType="numeric" styles={styles} colors={colors} />
        <Field label="Opening stock" value={stock} onChangeText={setStock} placeholder="Opening stock" keyboardType="numeric" styles={styles} colors={colors} />
        <Field label="Material" value={material} onChangeText={setMaterial} placeholder="Material" styles={styles} colors={colors} />
        <Field label="Dimensions" value={dimensions} onChangeText={setDimensions} placeholder="Dimensions" styles={styles} colors={colors} />
        <Text style={styles.fieldLabel}>Category</Text>
        <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>{categories.map((category) => <Pressable key={category.id} style={[styles.filterPill, categoryId === category.id && styles.filterPillActive]} onPress={() => setCategoryId(category.id)}><Text style={[styles.filterText, categoryId === category.id && styles.filterTextActive]}>{category.name}</Text></Pressable>)}</ScrollView>
        <Pressable testID="admin-gallery-upload" style={styles.uploadBox} onPress={chooseImages}><Ionicons name="images-outline" size={25} color={colors.brandPrimary} /><Text style={styles.bold}>{galleryImages.length ? `${galleryImages.length} gallery photos selected` : "Choose gallery photos"}</Text><Text style={styles.muted}>JPG upload · maximum 4</Text></Pressable>
        <Text style={styles.fieldLabel}>HTTPS image links</Text>
        <TextInput testID="admin-image-urls" value={imageUrls} onChangeText={setImageUrls} placeholder="https://example.com/product.jpg" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]} multiline autoCapitalize="none" />
        <Text style={styles.muted}>Paste one or more HTTPS links separated by spaces or commas. The server converts them to base64.</Text>
        {message ? <Text style={styles.formMessage}>{message}</Text> : null}
        <Pressable testID="admin-add-product" style={styles.primaryButton} onPress={addProduct} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Add product</Text>}</Pressable>
      </>
      : tab === "Manage" ? <>
        <Text style={styles.pageTitle}>Manage products</Text>
        <Text style={styles.pageSubtitle}>Tap Edit to update category, stock, or pricing.</Text>
        {message ? <Text style={styles.formMessage}>{message}</Text> : null}
        {products.length ? products.map((product) => {
          const cat = categories.find((c) => c.id === product.category_id);
          return <View key={product.id} style={styles.orderCard}>
            <View style={styles.manageRow}>
              <View style={styles.manageThumb}>{product.images?.[0] ? <Image source={{ uri: imageUri(product.images[0]) }} style={styles.image} /> : <Ionicons name="cube-outline" size={26} color={colors.brandPrimary} />}</View>
              <View style={styles.flex}>
                <Text style={styles.bold} numberOfLines={2}>{product.name}</Text>
                <Text style={styles.muted}>{cat?.name || "No category"} · {money(product.price)}</Text>
                <Text style={[styles.rating, { color: product.stock > 0 ? colors.success : colors.error, marginTop: 4 }]}>Stock: {product.stock}</Text>
              </View>
            </View>
            <View style={styles.adminOrderActions}>
              <Pressable testID={`edit-product-${product.id}`} style={styles.smallAction} onPress={() => setEditProduct(product)}><Ionicons name="create-outline" size={16} color={colors.brandPrimary} /><Text style={styles.smallActionText}>Edit</Text></Pressable>
              <Pressable testID={`delete-product-${product.id}`} style={styles.smallAction} onPress={() => deleteProduct(product)}><Ionicons name="trash-outline" size={16} color={colors.error} /><Text style={styles.smallActionText}>Delete</Text></Pressable>
            </View>
          </View>;
        }) : <Text style={styles.muted}>Add a product first to manage it here.</Text>}
      </>
      : tab === "Stock" ? <>
        <Text style={styles.pageTitle}>Stock & purchases</Text>
        <Text style={styles.pageSubtitle}>Record purchased quantities or correct the current stock level.</Text>
        {products.length ? <>
          <Text style={styles.fieldLabel}>Choose product</Text>
          <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>{products.map((product) => <Pressable key={product.id} style={[styles.filterPill, selectedId === product.id && styles.filterPillActive]} onPress={() => setSelectedId(product.id)}><Text style={[styles.filterText, selectedId === product.id && styles.filterTextActive]}>{product.name}</Text></Pressable>)}</ScrollView>
          <View style={styles.infoCard}><Ionicons name="cube-outline" size={22} color={colors.brandPrimary} /><View><Text style={styles.bold}>{selected?.name}</Text><Text style={styles.muted}>Current stock: {selected?.stock ?? 0}</Text></View></View>
          <Field testID="stock-quantity" label="Quantity" value={stockQuantity} onChangeText={setStockQuantity} placeholder="Quantity" keyboardType="numeric" styles={styles} colors={colors} />
          <Field label="Purchase note (optional)" value={stockNote} onChangeText={setStockNote} placeholder="Supplier or invoice note" styles={styles} colors={colors} />
          <View style={styles.adminOrderActions}>
            <Pressable testID="stock-purchase" style={styles.primaryButtonSmall} onPress={() => updateStock("add")} disabled={busy}><Text style={styles.primaryButtonText}>Add purchased stock</Text></Pressable>
            <Pressable testID="stock-set" style={styles.secondaryButton} onPress={() => updateStock("set")} disabled={busy}><Text style={styles.secondaryButtonText}>Set stock</Text></Pressable>
          </View>
          <Text style={styles.sectionTitle}>Recent stock activity</Text>
          {history.length ? history.slice(0, 8).map((event) => <View style={styles.listRow} key={event.id}><Ionicons name={event.operation === "add" ? "add-circle-outline" : "create-outline"} size={20} color={colors.brandPrimary} /><Text style={styles.flexText}>{event.operation === "add" ? `+${event.quantity}` : `Set ${event.quantity}`} · {event.note}</Text><Text style={styles.muted}>{new Date(event.created_at).toLocaleDateString("en-IN")}</Text></View>) : <Text style={styles.muted}>No stock activity yet.</Text>}
        </> : <Text style={styles.muted}>Add a product first to manage stock.</Text>}
        {message ? <Text style={styles.formMessage}>{message}</Text> : null}
      </>
      : tab === "Categories" ? <>
        <Text style={styles.pageTitle}>Manage categories</Text>
        <View style={styles.inline}>
          <TextInput testID="admin-category-name" value={newCategory} onChangeText={setNewCategory} placeholder="New category name" placeholderTextColor={colors.muted} style={[styles.input, styles.inlineInput]} />
          <Pressable testID="admin-add-category" style={styles.squareButton} onPress={addCategory}><Ionicons name="add" size={22} color={colors.onBrandPrimary} /></Pressable>
        </View>
        {categories.map((category) => <View style={styles.listRow} key={category.id}><Ionicons name="grid-outline" size={21} color={colors.brandPrimary} /><Text style={styles.flexText}>{category.name}</Text><Text style={styles.muted}>{category.product_count}</Text></View>)}
      </>
      : tab === "Users" ? <>
        <Text style={styles.pageTitle}>Customer approvals</Text>
        <Text style={styles.pageSubtitle}>Approve customers after verifying them on WhatsApp.</Text>
        <View style={styles.filterRow}>
          {(["pending", "approved"] as const).map((view) => <Pressable testID={`users-${view}`} key={view} style={[styles.filterPill, userView === view && styles.filterPillActive]} onPress={() => setUserView(view)}><Text style={[styles.filterText, userView === view && styles.filterTextActive]}>{view === "pending" ? `Pending (${pendingUsers.length})` : `Approved (${approvedUsers.length})`}</Text></Pressable>)}
        </View>
        {message ? <Text style={styles.formMessage}>{message}</Text> : null}
        {(userView === "pending" ? pendingUsers : approvedUsers).length ? (userView === "pending" ? pendingUsers : approvedUsers).map((user) => <View key={user.id} style={styles.orderCard}>
          <View style={styles.orderTop}><Text style={styles.bold}>{user.full_name}</Text><Text style={[styles.status, { color: user.is_approved ? colors.success : colors.warning }]}>{user.is_approved ? "Approved" : "Pending"}</Text></View>
          <Text style={styles.muted}>{user.identifier}</Text>
          {user.created_at ? <Text style={styles.muted}>Joined {new Date(user.created_at).toLocaleDateString("en-IN")}</Text> : null}
          <View style={styles.adminOrderActions}>
            {!user.is_approved ? <Pressable testID={`approve-${user.id}`} style={styles.smallAction} onPress={() => approve(user)}><Ionicons name="checkmark-circle-outline" size={16} color={colors.success} /><Text style={styles.smallActionText}>Approve</Text></Pressable> : null}
            {!user.is_approved ? <Pressable testID={`reject-${user.id}`} style={styles.smallAction} onPress={() => reject(user)}><Ionicons name="close-circle-outline" size={16} color={colors.error} /><Text style={styles.smallActionText}>Reject</Text></Pressable> : null}
            <Pressable testID={`whatsapp-${user.id}`} style={styles.smallAction} onPress={() => whatsappUser(user)}><Ionicons name="logo-whatsapp" size={16} color={colors.success} /><Text style={styles.smallActionText}>WhatsApp</Text></Pressable>
          </View>
        </View>) : <Text style={styles.muted}>{userView === "pending" ? "No pending approvals right now." : "No approved customers yet."}</Text>}
      </>
      : <>
        <Text style={styles.pageTitle}>Order history</Text>
        {orders.length ? orders.map((order) => <View style={styles.orderCard} key={order.id}>
          <View style={styles.orderTop}><Text style={styles.bold}>{order.id}</Text><Text style={styles.status}>{order.status}</Text></View>
          <Text style={styles.muted}>{order.customer_name} · {money(order.total)}</Text>
          <Text style={styles.muted}>{order.address?.mobile}</Text>
          <View style={styles.adminOrderActions}>
            {order.status === "dispatched" || order.status === "cancelled" ? <Pressable testID={`delete-order-${order.id}`} style={styles.smallAction} onPress={() => remove(order)}><Ionicons name="trash-outline" size={16} color={colors.error} /><Text style={styles.smallActionText}>Delete</Text></Pressable> : <Pressable style={styles.smallAction} onPress={() => api.updateOrder(order.id, order.status === "processing" ? "dispatched" : "delivered").then(refresh)}><Text style={styles.smallActionText}>{order.status === "processing" ? "Dispatch" : "Mark delivered"}</Text></Pressable>}
            {order.status === "processing" ? <Pressable style={styles.smallAction} onPress={() => api.updateOrder(order.id, "cancelled").then(refresh)}><Ionicons name="close-circle-outline" size={16} color={colors.error} /><Text style={styles.smallActionText}>Cancel</Text></Pressable> : null}
            <Pressable testID={`share-order-${order.id}`} style={styles.smallAction} onPress={() => share(order)}><Ionicons name="logo-whatsapp" size={16} color={colors.success} /><Text style={styles.smallActionText}>WhatsApp share</Text></Pressable>
          </View>
        </View>) : <Text style={styles.muted}>Orders will appear here once customers check out.</Text>}
      </>}
    </ScrollView>
    {editProduct ? <EditProductModal product={editProduct} categories={categories} onClose={() => setEditProduct(null)} onSaved={async () => { setEditProduct(null); await refresh(); setMessage("Product updated."); }} styles={styles} colors={colors} /> : null}
  </View>;
}

function EditProductModal({ product, categories, onClose, onSaved, styles, colors }: any) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [categoryId, setCategoryId] = useState(product.category_id);
  const [price, setPrice] = useState(String(product.price));
  const [mrp, setMrp] = useState(String(product.mrp));
  const [stock, setStock] = useState(String(product.stock));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.patchProduct(product.id, { name, description, category_id: categoryId, price: Number(price), mrp: Number(mrp), stock: Number(stock) });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <View style={styles.filterSheet}>
        <View style={styles.sheetHead}><Text style={styles.sectionTitle}>Edit product</Text><Pressable style={styles.iconButton} onPress={onClose}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Field label="Name" value={name} onChangeText={setName} placeholder="Product name" styles={styles} colors={colors} />
          <Field label="Description" value={description} onChangeText={setDescription} placeholder="Short description" styles={styles} colors={colors} />
          <Field label="MRP" value={mrp} onChangeText={setMrp} placeholder="MRP" keyboardType="numeric" styles={styles} colors={colors} />
          <Field label="Selling price" value={price} onChangeText={setPrice} placeholder="Selling price" keyboardType="numeric" styles={styles} colors={colors} />
          <Field testID="edit-stock" label="Stock (SKU)" value={stock} onChangeText={setStock} placeholder="Stock" keyboardType="numeric" styles={styles} colors={colors} />
          <Text style={styles.fieldLabel}>Category</Text>
          <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
            {categories.map((category: Category) => <Pressable testID={`edit-category-${category.id}`} key={category.id} style={[styles.filterPill, categoryId === category.id && styles.filterPillActive]} onPress={() => setCategoryId(category.id)}><Text style={[styles.filterText, categoryId === category.id && styles.filterTextActive]}>{category.name}</Text></Pressable>)}
          </ScrollView>
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.sheetActions}>
          <Pressable style={styles.secondaryButton} onPress={onClose}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
          <Pressable testID="save-edit-product" style={styles.primaryButtonSmall} onPress={save} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Save changes</Text>}</Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

function Field({ label, value, onChangeText, placeholder, styles, colors, keyboardType = "default", testID }: any) { return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} keyboardType={keyboardType} style={styles.input} autoCapitalize="none" /></View>; }
