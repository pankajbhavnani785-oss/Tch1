// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, CartItem, Category, Order, Product, ProductFilters, Review, User, clearSession, loadSession, saveSession } from "@/src/api";
import { useTheme } from "@/src/theme";
import { AdminStudio } from "@/src/components/admin-studio";

const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const imageUri = (source?: string) => source ? (source.startsWith("data:") ? source : `data:image/jpeg;base64,${source}`) : "";
const sale = (product: Product) => product.mrp > product.price ? `${Math.round(((product.mrp - product.price) / product.mrp) * 100)}% OFF` : "";

export default function Index() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Home");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [detail, setDetail] = useState<Product | null>(null);
  const [screen, setScreen] = useState<"store" | "cart" | "checkout" | "admin">("store");
  const [error, setError] = useState("");

  useEffect(() => { loadSession().then(setSession).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (session?.user.is_approved || session?.user.role === "admin") refresh(); }, [session]);

  const refresh = async () => {
    setError("");
    try {
      const [c, p, o] = await Promise.all([api.categories(), api.products(), api.orders()]);
      setCategories(c); setProducts(p); setOrders(o);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load TCH"); }
  };
  const refreshMe = async () => {
    try {
      const user = await api.me();
      if (session) { setSession({ token: session.token, user }); await saveSession(session.token, user); }
    } catch { /* ignore */ }
  };
  const add = (product: Product) => setCart((old) => { const found = old.find((item) => item.id === product.id); return found ? old.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...old, { ...product, quantity: 1 }]; });
  const quantity = (id: string, amount: number) => setCart((old) => old.map((item) => item.id === id ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0));
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (loading) return <View style={[styles.root, styles.center]}><ActivityIndicator size="large" color={colors.brandPrimary} /><Text style={styles.muted}>Opening TCH Kitchenware…</Text></View>;
  if (!session) return <Auth onSuccess={(data) => { saveSession(data.token, data.user); setSession(data); }} styles={styles} colors={colors} />;
  if (session.user.role !== "admin" && !session.user.is_approved) return <Pending session={session} onCheck={refreshMe} onLogout={async () => { await clearSession(); setSession(null); }} styles={styles} colors={colors} />;
  if (detail) return <Detail product={detail} products={products} onBack={() => setDetail(null)} onAdd={() => { add(detail); setDetail(null); }} onOpen={setDetail} styles={styles} colors={colors} />;
  if (screen === "cart") return <Cart cart={cart} subtotal={subtotal} onBack={() => setScreen("store")} onChange={quantity} onCheckout={() => setScreen("checkout")} styles={styles} colors={colors} />;
  if (screen === "checkout") return <Checkout cart={cart} subtotal={subtotal} onBack={() => setScreen("cart")} onPlaced={(order) => { setOrders((old) => [order, ...old]); setCart([]); setActiveTab("Orders"); setScreen("store"); }} styles={styles} colors={colors} />;
  if (screen === "admin") return <AdminStudio categories={categories} products={products} orders={orders} onBack={() => setScreen("store")} refresh={refresh} styles={styles} colors={colors} />;

  const openCategory = async (id: string) => {
    setActiveTab("Products");
    try { setProducts(await api.products({ category_id: id })); } catch (e) { setError(e instanceof Error ? e.message : "Unable to filter products"); }
  };
  const content = activeTab === "Home" ? <Home categories={categories} products={products} onBrowse={() => setActiveTab("Products")} onCategory={openCategory} onProduct={setDetail} onAdd={add} styles={styles} colors={colors} />
    : activeTab === "Categories" ? <Categories categories={categories} onCategory={openCategory} styles={styles} colors={colors} />
      : activeTab === "Products" ? <Products products={products} setProducts={setProducts} categories={categories} onProduct={setDetail} onAdd={add} styles={styles} colors={colors} />
        : activeTab === "Orders" ? <Orders orders={orders} products={products} onReorder={(items) => { setCart(items); setScreen("cart"); }} styles={styles} colors={colors} />
          : <Profile session={session} onAdmin={() => setScreen("admin")} onLogout={async () => { await clearSession(); setSession(null); }} styles={styles} colors={colors} />;
  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}><View><Text style={styles.logo}>TCH</Text><Text style={styles.headerSub}>KITCHENWARE & GIFTS</Text></View><View style={styles.headerActions}><Pressable testID="location-button" style={styles.iconButton}><Ionicons name="location-outline" size={21} color={colors.onSurface} /></Pressable><Pressable testID="notification-button" style={styles.iconButton}><Ionicons name="notifications-outline" size={22} color={colors.onSurface} /></Pressable><Pressable testID="cart-button" style={styles.cartButton} onPress={() => setScreen("cart")}><Ionicons name="bag-handle-outline" size={22} color={colors.onBrandPrimary} />{cart.length ? <View style={styles.badge}><Text style={styles.badgeText}>{cart.length}</Text></View> : null}</Pressable></View></View>
    {error ? <Pressable style={styles.errorBar} onPress={refresh}><Text style={styles.errorText}>{error} · Tap to retry</Text></Pressable> : null}
    <View style={styles.content}>{content}</View>
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>{["Home", "Categories", "Products", "Orders", "Profile"].map((tab) => <Pressable testID={`tab-${tab.toLowerCase()}`} key={tab} style={styles.tab} onPress={() => setActiveTab(tab)}><Ionicons name={tab === "Home" ? "home-outline" : tab === "Categories" ? "grid-outline" : tab === "Products" ? "storefront-outline" : tab === "Orders" ? "receipt-outline" : "person-outline"} size={21} color={activeTab === tab ? colors.brandPrimary : colors.muted} /><Text style={[styles.tabText, activeTab === tab && { color: colors.brandPrimary }]}>{tab}</Text></Pressable>)}</View>
  </View>;
}

function Pending({ session, onCheck, onLogout, styles, colors }: any) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); await onCheck(); setBusy(false); };
  const openWhatsapp = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`Hi TCH team, please approve my account. Name: ${session.user.full_name}, ID: ${session.user.identifier}`)}`).catch(() => {});
  return <View style={[styles.root, { paddingTop: insets.top }]}><ScrollView contentContainerStyle={styles.pendingWrap}>
    <View style={styles.pendingBadge}><Ionicons name="hourglass-outline" size={40} color={colors.onBrandPrimary} /></View>
    <Text style={styles.authTitle}>Approval pending</Text>
    <Text style={styles.pendingText}>Hi {session.user.full_name.split(" ")[0]}, TCH admin needs to approve your account before you can shop. Reach out to us on WhatsApp with your registration details and we&apos;ll unlock the store shortly.</Text>
    <View style={styles.pendingCard}><Text style={styles.muted}>Registered as</Text><Text style={styles.bold}>{session.user.identifier}</Text></View>
    <Pressable testID="pending-whatsapp" style={styles.primaryButton} onPress={openWhatsapp}><Ionicons name="logo-whatsapp" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryButtonText}>  Message TCH on WhatsApp</Text></Pressable>
    <Pressable testID="pending-refresh" style={styles.secondaryButton} onPress={check} disabled={busy}>{busy ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.secondaryButtonText}>I&apos;ve been approved · Refresh</Text>}</Pressable>
    <Pressable style={styles.linkButton} onPress={onLogout}><Text style={styles.linkText}>Sign out</Text></Pressable>
  </ScrollView></View>;
}

function Auth({ onSuccess, styles, colors }: { onSuccess: (data: { token: string; user: User }) => void; styles: any; colors: any }) {
  const insets = useSafeAreaInsets(); const [admin, setAdmin] = useState(false); const [register, setRegister] = useState(false); const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const submit = async () => { setBusy(true); setMessage(""); try { onSuccess(register && !admin ? await api.register(identifier, password, name) : await api.login(identifier, password, admin)); } catch (e) { setMessage(e instanceof Error ? e.message : "Please try again"); } finally { setBusy(false); } };
  return <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === "ios" ? "padding" : "height"}><ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled"><View style={styles.logoMark}><Ionicons name="restaurant-outline" size={34} color={colors.onBrandPrimary} /></View><Text style={styles.authLogo}>TCH</Text><Text style={styles.authTitle}>{admin ? "Admin sign in" : register ? "Create your account" : "Welcome to TCH"}</Text><Text style={styles.authSubtitle}>{admin ? "Private store controls for approved admins" : register ? "New accounts unlock after admin approval." : "Sign in to explore crockery, gifts and homeware"}</Text>{register && !admin ? <Field label="Your name" value={name} onChangeText={setName} placeholder="Full name" styles={styles} colors={colors} /> : null}<Field testID="auth-identifier" label={admin ? "Admin email" : "Email or mobile"} value={identifier} onChangeText={setIdentifier} placeholder={admin ? "admin@tch.in" : "you@example.com or mobile"} styles={styles} colors={colors} keyboardType={admin ? "email-address" : "default"} /><Field testID="auth-password" label="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" styles={styles} colors={colors} secureTextEntry />{message ? <Text style={styles.formError}>{message}</Text> : null}<Pressable testID="auth-submit" style={styles.primaryButton} onPress={submit} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{register && !admin ? "Create account" : "Continue"}</Text>}</Pressable><Pressable style={styles.linkButton} onPress={() => setRegister(!register)}><Text style={styles.linkText}>{admin ? "Customer sign in" : register ? "Already have an account? Sign in" : "New to TCH? Create an account"}</Text></Pressable><Pressable style={styles.adminLink} onPress={() => { setAdmin(!admin); setRegister(false); setMessage(""); }}><Ionicons name={admin ? "arrow-back-outline" : "shield-checkmark-outline"} size={17} color={colors.muted} /><Text style={styles.muted}>{admin ? "Back to customer access" : "Admin access"}</Text></Pressable></ScrollView></KeyboardAvoidingView>;
}

function Field({ label, value, onChangeText, placeholder, styles, colors, secureTextEntry = false, keyboardType = "default", testID }: any) { return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} secureTextEntry={secureTextEntry} keyboardType={keyboardType} style={styles.input} autoCapitalize="none" /></View>; }
function Page({ children, styles }: any) { return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>{children}</ScrollView>; }
function Search({ value, onChangeText, styles, colors }: any) { return <View style={styles.search}><Ionicons name="search-outline" size={19} color={colors.muted} /><TextInput testID="product-search" value={value} onChangeText={onChangeText} placeholder="Search products..." placeholderTextColor={colors.muted} style={styles.searchInput} /><Ionicons name="mic-outline" size={19} color={colors.brandPrimary} /></View>; }
function Section({ title, action, onPress, styles }: any) { return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Pressable onPress={onPress}><Text style={styles.linkText}>{action}</Text></Pressable> : null}</View>; }

function Home({ categories, products, onBrowse, onCategory, onProduct, onAdd, styles, colors }: any) { const [search, setSearch] = useState(""); const visible = products.filter((p: Product) => p.name.toLowerCase().includes(search.toLowerCase())); return <Page styles={styles}><Search value={search} onChangeText={setSearch} styles={styles} colors={colors} /><View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.heroEyebrow}>TCH COLLECTION</Text><Text style={styles.heroTitle}>Beautiful pieces for everyday moments.</Text><Text style={styles.heroText}>Curated crockery and gifts for your home.</Text><Pressable testID="shop-now" style={styles.heroButton} onPress={onBrowse}><Text style={styles.heroButtonText}>Shop now</Text><Ionicons name="arrow-forward" size={16} color={colors.onBrandPrimary} /></Pressable></View><Ionicons name="wine-outline" size={90} color={colors.onBrandPrimary} /></View><Section title="Shop by category" action="See all" onPress={() => {}} styles={styles} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontal}>{categories.slice(0, 8).map((category: Category) => <Pressable key={category.id} style={styles.categoryChip} onPress={() => onCategory(category.id)}><View style={styles.categoryIcon}><Ionicons name="grid-outline" size={20} color={colors.brandPrimary} /></View><Text style={styles.categoryName} numberOfLines={2}>{category.name}</Text></Pressable>)}</ScrollView><Section title="Featured picks" action="View all" onPress={onBrowse} styles={styles} />{visible.length ? <View style={styles.grid}>{visible.slice(0, 6).map((p: Product) => <Card key={p.id} product={p} onPress={() => onProduct(p)} onAdd={() => onAdd(p)} styles={styles} colors={colors} />)}</View> : <Empty icon="sparkles-outline" title="Your next favorite piece starts here" text="Our catalog is being curated. Browse categories or check back soon." styles={styles} colors={colors} />}</Page>; }

function Categories({ categories, onCategory, styles, colors }: any) { return <Page styles={styles}><Text style={styles.pageTitle}>Categories</Text><Text style={styles.pageSubtitle}>Find something made for your space.</Text><View style={styles.categoryGrid}>{categories.map((category: Category) => <Pressable key={category.id} style={styles.categoryCard} onPress={() => onCategory(category.id)}><View style={styles.categoryLargeIcon}><Ionicons name="grid-outline" size={26} color={colors.brandPrimary} /></View><Text style={styles.categoryCardTitle}>{category.name}</Text><Text style={styles.muted}>{category.product_count} products</Text></Pressable>)}</View></Page>; }

function Products({ products, setProducts, categories, onProduct, onAdd, styles, colors }: any) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [minDiscount, setMinDiscount] = useState(0);
  const [available, setAvailable] = useState(false);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    try {
      const filters: ProductFilters = { search: search || undefined, sort, category_id: category || undefined, available, min_price: Number(minPrice) || 0, max_price: Number(maxPrice) || 0, min_rating: minRating, min_discount: minDiscount };
      setProducts(await api.products(filters));
    } finally { setBusy(false); }
  };
  const reset = async () => { setSearch(""); setSort("newest"); setMinPrice(""); setMaxPrice(""); setMinRating(0); setMinDiscount(0); setAvailable(false); setCategory(""); setProducts(await api.products({})); };
  const active = (minPrice || maxPrice || minRating || minDiscount || available || category) ? 1 : 0;

  return <Page styles={styles}>
    <Text style={styles.pageTitle}>Products</Text>
    <Search value={search} onChangeText={setSearch} styles={styles} colors={colors} />
    <View style={styles.sortRow}>
      <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
        {[["newest", "Newest"], ["price_low", "Price low"], ["price_high", "Price high"], ["rating", "Top rated"], ["popular", "Popular"]].map(([value, label]) => <Pressable testID={`sort-${value}`} key={value} style={[styles.filterPill, sort === value && styles.filterPillActive]} onPress={() => setSort(value)}><Text style={[styles.filterText, sort === value && styles.filterTextActive]}>{label}</Text></Pressable>)}
      </ScrollView>
      <Pressable testID="open-filters" style={[styles.filterIcon, active ? styles.filterIconActive : null]} onPress={() => setShowFilters(true)}>
        <Ionicons name="options-outline" size={20} color={active ? colors.onBrandPrimary : colors.onSurface} />
      </Pressable>
    </View>
    <Pressable style={styles.applyRow} onPress={apply}><Text style={styles.linkText}>{busy ? "Loading..." : "Apply search & sort"}</Text></Pressable>
    {products.length ? <View style={styles.grid}>{products.map((product: Product) => <Card key={product.id} product={product} onPress={() => onProduct(product)} onAdd={() => onAdd(product)} styles={styles} colors={colors} />)}</View> : <Empty icon="search-outline" title="No products found" text="Try another search or adjust filters." styles={styles} colors={colors} />}
    <Modal visible={showFilters} animationType="slide" transparent onRequestClose={() => setShowFilters(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.filterSheet}>
          <View style={styles.sheetHead}><Text style={styles.sectionTitle}>Filters</Text><Pressable style={styles.iconButton} onPress={() => setShowFilters(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable></View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
              <Pressable style={[styles.filterPill, !category && styles.filterPillActive]} onPress={() => setCategory("")}><Text style={[styles.filterText, !category && styles.filterTextActive]}>All</Text></Pressable>
              {categories.map((c: Category) => <Pressable key={c.id} style={[styles.filterPill, category === c.id && styles.filterPillActive]} onPress={() => setCategory(c.id)}><Text style={[styles.filterText, category === c.id && styles.filterTextActive]}>{c.name}</Text></Pressable>)}
            </ScrollView>
            <Text style={styles.fieldLabel}>Price range</Text>
            <View style={styles.rangeRow}>
              <TextInput testID="filter-min-price" value={minPrice} onChangeText={setMinPrice} placeholder="Min ₹" placeholderTextColor={colors.muted} keyboardType="numeric" style={[styles.input, styles.rangeInput]} />
              <TextInput testID="filter-max-price" value={maxPrice} onChangeText={setMaxPrice} placeholder="Max ₹" placeholderTextColor={colors.muted} keyboardType="numeric" style={[styles.input, styles.rangeInput]} />
            </View>
            <Text style={styles.fieldLabel}>Minimum rating</Text>
            <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
              {[0, 3, 3.5, 4, 4.5].map((value) => <Pressable testID={`filter-rating-${value}`} key={value} style={[styles.filterPill, minRating === value && styles.filterPillActive]} onPress={() => setMinRating(value)}><Text style={[styles.filterText, minRating === value && styles.filterTextActive]}>{value === 0 ? "Any" : `${value}★ & up`}</Text></Pressable>)}
            </ScrollView>
            <Text style={styles.fieldLabel}>Minimum discount</Text>
            <ScrollView horizontal contentContainerStyle={styles.horizontal} showsHorizontalScrollIndicator={false}>
              {[0, 10, 20, 30, 50].map((value) => <Pressable testID={`filter-discount-${value}`} key={value} style={[styles.filterPill, minDiscount === value && styles.filterPillActive]} onPress={() => setMinDiscount(value)}><Text style={[styles.filterText, minDiscount === value && styles.filterTextActive]}>{value === 0 ? "Any" : `${value}% +`}</Text></Pressable>)}
            </ScrollView>
            <Pressable testID="filter-availability" style={[styles.checkRow, available && styles.checkRowActive]} onPress={() => setAvailable(!available)}>
              <Ionicons name={available ? "checkbox" : "square-outline"} size={22} color={available ? colors.brandPrimary : colors.muted} />
              <Text style={styles.bold}>Show only in-stock items</Text>
            </Pressable>
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable testID="filter-reset" style={styles.secondaryButton} onPress={() => { reset(); setShowFilters(false); }}><Text style={styles.secondaryButtonText}>Reset</Text></Pressable>
            <Pressable testID="filter-apply" style={styles.primaryButtonSmall} onPress={() => { apply(); setShowFilters(false); }}><Text style={styles.primaryButtonText}>Apply filters</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </Page>;
}

function Card({ product, onPress, onAdd, styles, colors }: any) {
  const low = product.stock > 0 && product.stock <= 10;
  return <Pressable style={styles.productCard} onPress={onPress}>
    <View style={styles.productImage}>
      {product.images?.[0] ? <Image source={{ uri: imageUri(product.images[0]) }} style={styles.image} /> : <Ionicons name="cube-outline" size={42} color={colors.brandPrimary} />}
      {sale(product) ? <View style={styles.discount}><Text style={styles.discountText}>{sale(product)}</Text></View> : null}
      {product.stock === 0 ? <View style={[styles.stockPill, { backgroundColor: colors.error }]}><Text style={[styles.stockPillText, { color: colors.onError }]}>OUT</Text></View>
        : low ? <View style={[styles.stockPill, { backgroundColor: colors.warning }]}><Text style={[styles.stockPillText, { color: colors.onWarning }]}>Only {product.stock} left</Text></View>
          : null}
    </View>
    <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
    <Text style={styles.productDesc} numberOfLines={1}>{product.description || "TCH kitchenware"}</Text>
    <View style={styles.priceRow}><Text style={styles.price}>{money(product.price)}</Text>{product.mrp > product.price ? <Text style={styles.mrp}>{money(product.mrp)}</Text> : null}</View>
    <Text testID={`stock-${product.id}`} style={[styles.rating, { color: product.stock === 0 ? colors.error : low ? colors.warning : colors.success, marginTop: 4 }]}>
      {product.stock === 0 ? "Out of stock" : low ? `Only ${product.stock} left in stock` : `In stock · ${product.stock} available`}
    </Text>
    <View style={styles.cardBottom}>
      <Text style={styles.rating}>★ {product.rating.toFixed(1)}</Text>
      {product.stock > 0 ? <Pressable testID={`add-${product.id}`} style={styles.addButton} onPress={onAdd}><Ionicons name="add" size={17} color={colors.onBrandPrimary} /><Text style={styles.addText}>Add</Text></Pressable> : <Text style={styles.outStock}>Out of stock</Text>}
    </View>
  </Pressable>;
}

function Detail({ product, products, onBack, onAdd, onOpen, styles, colors }: any) {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setActive(0); api.reviews(product.id).then(setReviews).catch(() => setReviews([])); }, [product.id]);
  const similar = products.filter((p: Product) => p.category_id === product.category_id && p.id !== product.id).slice(0, 6);
  const submit = async () => {
    if (!comment.trim()) { setMessage("Add a short comment about the product."); return; }
    setBusy(true); setMessage("");
    try {
      await api.addReview(product.id, rating, comment.trim());
      setComment(""); setRating(5);
      setReviews(await api.reviews(product.id));
      setMessage("Thanks for reviewing this piece!");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not submit review"); } finally { setBusy(false); }
  };
  return <View style={styles.root}>
    <Top title="Product details" onBack={onBack} styles={styles} colors={colors} />
    <ScrollView contentContainerStyle={styles.detailPage}>
      <Pressable onPress={() => product.images?.length && setZoom(true)} style={styles.detailImage}>
        {product.images?.length ? <Image source={{ uri: imageUri(product.images[active]) }} style={styles.detailImageAsset} /> : <Ionicons name="cube-outline" size={80} color={colors.brandPrimary} />}
        {product.images?.length ? <View style={styles.zoomHint}><Ionicons name="search" size={13} color={colors.onBrandPrimary} /><Text style={styles.zoomHintText}>Tap to zoom</Text></View> : null}
      </Pressable>
      {product.images?.length > 1 ? <ScrollView horizontal contentContainerStyle={styles.thumbs}>{product.images.map((source: string, index: number) => <Pressable key={source} style={[styles.thumb, active === index && styles.thumbActive]} onPress={() => setActive(index)}><Image source={{ uri: imageUri(source) }} style={styles.thumbImage} /></Pressable>)}</ScrollView> : null}
      <Text style={styles.detailTitle}>{product.name}</Text>
      <Text style={styles.ratingLarge}>★ {product.rating.toFixed(1)}  <Text style={styles.muted}>{reviews.length} review{reviews.length === 1 ? "" : "s"}</Text></Text>
      <View style={styles.detailPrice}><Text style={styles.detailPriceValue}>{money(product.price)}</Text>{product.mrp > product.price ? <><Text style={styles.mrp}>{money(product.mrp)}</Text><Text style={styles.discountText}>{sale(product)}</Text></> : null}</View>
      <Text style={[styles.stock, { color: product.stock === 0 ? colors.error : product.stock <= 10 ? colors.warning : colors.success }]}>
        {product.stock === 0 ? "Currently out of stock" : product.stock <= 10 ? `Only ${product.stock} left in stock — order soon` : `In stock · ${product.stock} available`}
      </Text>
      <Text style={styles.detailDescription}>{product.description || "Thoughtfully selected by TCH for beautiful everyday living."}</Text>
      <View style={styles.specRow}><Spec label="Material" value={product.material || "Premium finish"} styles={styles} /><Spec label="Dimensions" value={product.dimensions || "Made for your home"} styles={styles} /></View>

      {similar.length ? <View style={{ marginTop: 30 }}>
        <Text style={styles.sectionTitle}>Similar products</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarRow}>
          {similar.map((p: Product) => <Pressable key={p.id} style={styles.similarCard} onPress={() => onOpen(p)}>
            <View style={styles.similarImage}>{p.images?.[0] ? <Image source={{ uri: imageUri(p.images[0]) }} style={styles.image} /> : <Ionicons name="cube-outline" size={30} color={colors.brandPrimary} />}</View>
            <Text style={styles.similarName} numberOfLines={2}>{p.name}</Text>
            <Text style={styles.price}>{money(p.price)}</Text>
          </Pressable>)}
        </ScrollView>
      </View> : null}

      <View style={{ marginTop: 30 }}>
        <Text style={styles.sectionTitle}>Customer reviews</Text>
        <View style={styles.reviewForm}>
          <Text style={styles.fieldLabel}>Your rating</Text>
          <View style={styles.starRow}>{[1, 2, 3, 4, 5].map((value) => <Pressable testID={`review-star-${value}`} key={value} onPress={() => setRating(value)}><Ionicons name={value <= rating ? "star" : "star-outline"} size={26} color={colors.warning} /></Pressable>)}</View>
          <TextInput testID="review-comment" value={comment} onChangeText={setComment} placeholder="Share your experience..." placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 72, textAlignVertical: "top", marginTop: 10 }]} multiline />
          {message ? <Text style={styles.formMessage}>{message}</Text> : null}
          <Pressable testID="submit-review" style={styles.secondaryButton} onPress={submit} disabled={busy}>{busy ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.secondaryButtonText}>Submit review</Text>}</Pressable>
        </View>
        {reviews.length ? reviews.map((review) => <View key={review.id} style={styles.reviewCard}>
          <View style={styles.reviewTop}><Text style={styles.bold}>{review.user_name}</Text><Text style={styles.rating}>{"★".repeat(review.rating)}</Text></View>
          <Text style={styles.reviewText}>{review.comment}</Text>
          <Text style={styles.muted}>{new Date(review.created_at).toLocaleDateString("en-IN")}</Text>
        </View>) : <Text style={styles.muted}>No reviews yet · be the first to share your experience.</Text>}
      </View>
    </ScrollView>
    <View style={styles.detailActions}>
      <Pressable style={styles.secondaryButton} onPress={onAdd} disabled={!product.stock}><Text style={styles.secondaryButtonText}>Add to cart</Text></Pressable>
      <Pressable style={styles.primaryButtonSmall} onPress={onAdd} disabled={!product.stock}><Text style={styles.primaryButtonText}>Buy now</Text></Pressable>
    </View>
    <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
      <View style={styles.zoomWrap}>
        <Pressable style={styles.zoomClose} onPress={() => setZoom(false)}><Ionicons name="close" size={26} color="#FFFFFF" /></Pressable>
        <ScrollView contentContainerStyle={styles.zoomScroll} maximumZoomScale={4} minimumZoomScale={1} pinchGestureEnabled bouncesZoom centerContent>
          {product.images?.[active] ? <Image source={{ uri: imageUri(product.images[active]) }} style={styles.zoomImage} resizeMode="contain" /> : null}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
function Spec({ label, value, styles }: any) { return <View style={styles.spec}><Text style={styles.muted}>{label}</Text><Text style={styles.specValue}>{value}</Text></View>; }
function Top({ title, onBack, styles, colors }: any) { return <View style={styles.detailHeader}><Pressable style={styles.iconButton} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.headerTitle}>{title}</Text><View style={styles.iconButton} /></View>; }

function Cart({ cart, subtotal, onBack, onChange, onCheckout, styles, colors }: any) { return <View style={styles.root}><Top title="Your cart" onBack={onBack} styles={styles} colors={colors} /><ScrollView contentContainerStyle={styles.page}>{cart.length ? cart.map((item: CartItem) => <View style={styles.cartItem} key={item.id}><View style={styles.cartImage}>{item.images?.[0] ? <Image source={{ uri: imageUri(item.images[0]) }} style={styles.image} /> : <Ionicons name="cube-outline" size={30} color={colors.brandPrimary} />}</View><View style={styles.cartInfo}><Text style={styles.productName} numberOfLines={2}>{item.name}</Text><Text style={styles.price}>{money(item.price)}</Text><View style={styles.quantity}><Pressable style={styles.quantityButton} onPress={() => onChange(item.id, -1)}><Ionicons name="remove" size={17} color={colors.onSurface} /></Pressable><Text style={styles.quantityText}>{item.quantity}</Text><Pressable style={styles.quantityButton} onPress={() => onChange(item.id, 1)}><Ionicons name="add" size={17} color={colors.onSurface} /></Pressable></View></View><Text style={styles.cartTotal}>{money(item.price * item.quantity)}</Text></View>) : <Empty icon="bag-handle-outline" title="Your cart is waiting" text="Add pieces you love and they'll show up here." styles={styles} colors={colors} />}<Summary subtotal={subtotal} styles={styles} colors={colors} /></ScrollView>{cart.length ? <View style={styles.bottomAction}><Pressable testID="checkout-button" style={styles.primaryButton} onPress={onCheckout}><Text style={styles.primaryButtonText}>Proceed to checkout · {money(subtotal)}</Text></Pressable></View> : null}</View>; }
function Summary({ subtotal, styles, colors }: any) { return <View style={styles.summary}><Text style={styles.sectionTitle}>Order summary</Text><Line label="Subtotal" value={money(subtotal)} styles={styles} /><Line label="Delivery" value="Free" styles={styles} /><View style={styles.summaryDivider} /><Line label="Grand total" value={money(subtotal)} bold styles={styles} /><View style={styles.cod}><Ionicons name="cash-outline" size={20} color={colors.success} /><Text style={styles.codText}>Cash on Delivery available</Text></View></View>; }
function Line({ label, value, styles, bold = false }: any) { return <View style={styles.line}><Text style={bold ? styles.bold : styles.muted}>{label}</Text><Text style={bold ? styles.bold : styles.body}>{value}</Text></View>; }

function Checkout({ cart, subtotal, onBack, onPlaced, styles, colors }: any) { const [form, setForm] = useState({ full_name: "", mobile: "", email: "", address: "", landmark: "", city: "", state: "", pincode: "" }); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const update = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value })); const place = async () => { if (!form.full_name || !form.mobile || !form.address || !form.city || !form.state || !form.pincode) { setMessage("Please complete the delivery details."); return; } setBusy(true); try { onPlaced(await api.createOrder({ items: cart.map((item) => ({ product_id: item.id, name: item.name, image: item.images?.[0] || "", price: item.price, quantity: item.quantity })), address: form, subtotal, discount: 0, delivery_charge: 0, total: subtotal })); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not place order"); } finally { setBusy(false); } }; return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}><Top title="Checkout" onBack={onBack} styles={styles} colors={colors} /><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled"><Text style={styles.pageTitle}>Delivery details</Text><Text style={styles.pageSubtitle}>Where should we send your TCH pieces?</Text>{[["full_name", "Full name"], ["mobile", "Mobile number"], ["email", "Email (optional)"], ["address", "Full address"], ["landmark", "Landmark (optional)"], ["city", "City"], ["state", "State"], ["pincode", "Pincode"]].map(([key, label]) => <Field key={key} label={label} value={(form as any)[key]} onChangeText={(value: string) => update(key, value)} placeholder={label} styles={styles} colors={colors} keyboardType={key === "mobile" || key === "pincode" ? "phone-pad" : "default"} />)}{message ? <Text style={styles.formError}>{message}</Text> : null}<View style={styles.deliveryCard}><Ionicons name="shield-checkmark-outline" size={21} color={colors.success} /><View style={styles.flex}><Text style={styles.bold}>Cash on Delivery</Text><Text style={styles.muted}>Estimated delivery in 3–5 business days</Text></View></View><Summary subtotal={subtotal} styles={styles} colors={colors} /></ScrollView><View style={styles.bottomAction}><Pressable testID="place-order" style={styles.primaryButton} onPress={place} disabled={busy}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Place order · {money(subtotal)}</Text>}</Pressable></View></KeyboardAvoidingView>; }

function Orders({ orders, products, onReorder, styles, colors }: any) {
  const [message, setMessage] = useState("");
  const reorder = (order: Order) => {
    const cartItems: CartItem[] = [];
    let unavailable = 0;
    for (const item of order.items) {
      const product = products.find((p: Product) => p.id === item.product_id);
      if (product && product.stock > 0) cartItems.push({ ...product, quantity: Math.min(item.quantity, product.stock) });
      else unavailable += 1;
    }
    if (!cartItems.length) { setMessage("None of the items are available for reorder right now."); return; }
    setMessage(unavailable ? `${unavailable} item(s) unavailable and skipped.` : "");
    onReorder(cartItems);
  };
  return <Page styles={styles}>
    <Text style={styles.pageTitle}>Orders</Text>
    <Text style={styles.pageSubtitle}>Track every TCH delivery in one place.</Text>
    {message ? <Text style={styles.formMessage}>{message}</Text> : null}
    {orders.length ? orders.map((order: Order) => <View style={styles.orderCard} key={order.id}>
      <View style={styles.orderTop}><Text style={styles.bold}>{order.id}</Text><Text style={[styles.status, { color: order.status === "cancelled" ? colors.error : order.status === "delivered" ? colors.success : colors.brandPrimary }]}>{order.status}</Text></View>
      <Text style={styles.muted}>{new Date(order.created_at).toLocaleDateString("en-IN")} · {order.items.length} item(s)</Text>
      <Text style={styles.orderTotal}>{money(order.total)}</Text>
      <Text style={styles.muted}>{order.payment_method}</Text>
      <Pressable testID={`reorder-${order.id}`} style={[styles.smallAction, { alignSelf: "flex-start", marginTop: 12 }]} onPress={() => reorder(order)}>
        <Ionicons name="repeat-outline" size={16} color={colors.brandPrimary} />
        <Text style={styles.smallActionText}>Reorder</Text>
      </Pressable>
    </View>) : <Empty icon="receipt-outline" title="No orders yet" text="Your confirmed orders will appear here." styles={styles} colors={colors} />}
  </Page>;
}
function Profile({ session, onAdmin, onLogout, styles, colors }: any) { return <Page styles={styles}><Text style={styles.pageTitle}>Profile</Text><View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{session.user.full_name.slice(0, 1).toUpperCase()}</Text></View><View><Text style={styles.profileName}>{session.user.full_name}</Text><Text style={styles.muted}>{session.user.identifier}</Text></View></View>{session.user.role === "admin" ? <Pressable testID="admin-studio" style={styles.adminCard} onPress={onAdmin}><Ionicons name="settings-outline" size={24} color={colors.onBrandPrimary} /><View style={styles.flex}><Text style={styles.adminTitle}>Admin Studio</Text><Text style={styles.adminText}>Manage users, products, categories and orders</Text></View><Ionicons name="chevron-forward" size={20} color={colors.onBrandPrimary} /></Pressable> : <Info icon="location-outline" title="Saved addresses" text="Add an address during checkout" styles={styles} colors={colors} />}<Info icon="language-outline" title="Language" text="English · Hindi-ready" styles={styles} colors={colors} /><Info icon="information-circle-outline" title="About TCH" text="Crockery, gifts and kitchenware" styles={styles} colors={colors} /><Pressable style={styles.outlineButton} onPress={onLogout}><Text style={styles.outlineText}>Sign out</Text></Pressable></Page>; }
function Info({ icon, title, text, styles, colors }: any) { return <View style={styles.infoCard}><Ionicons name={icon} size={21} color={colors.brandPrimary} /><View><Text style={styles.bold}>{title}</Text><Text style={styles.muted}>{text}</Text></View></View>; }

function Empty({ icon, title, text, styles, colors }: any) { return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={icon} size={34} color={colors.brandPrimary} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{text}</Text></View>; }

function createStyles(colors: any) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, center: { alignItems: "center", justifyContent: "center", gap: 16 }, content: { flex: 1 },
  header: { paddingHorizontal: 18, paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider },
  logo: { color: colors.brandPrimary, fontSize: 27, fontWeight: "900", letterSpacing: 2 }, headerSub: { color: colors.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 }, iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cartButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", position: "relative" },
  badge: { position: "absolute", right: -1, top: -1, minWidth: 18, height: 18, borderRadius: 10, backgroundColor: colors.surfaceInverse, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.onSurfaceInverse, fontSize: 10, fontWeight: "800" }, errorBar: { backgroundColor: colors.error, padding: 10, alignItems: "center" }, errorText: { color: colors.onError, fontSize: 12, fontWeight: "700" },
  tabBar: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider }, tab: { flex: 1, minHeight: 59, alignItems: "center", justifyContent: "center", gap: 3 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  scroll: { flex: 1 }, page: { padding: 18, paddingBottom: 34 },
  search: { minHeight: 48, borderRadius: 14, backgroundColor: colors.surfaceTertiary, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 9, marginBottom: 22 }, searchInput: { flex: 1, color: colors.onSurface, fontSize: 14 },
  hero: { minHeight: 205, borderRadius: 20, backgroundColor: colors.brandSecondary, padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", overflow: "hidden", marginBottom: 28 },
  heroCopy: { flex: 1 }, heroEyebrow: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 9 }, heroTitle: { color: colors.onBrandPrimary, fontSize: 23, lineHeight: 28, fontWeight: "800", maxWidth: 245 }, heroText: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: 13, marginTop: 8, maxWidth: 230 },
  heroButton: { alignSelf: "flex-start", minHeight: 42, borderRadius: 21, paddingHorizontal: 15, marginTop: 17, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", gap: 8 }, heroButtonText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }, sectionTitle: { color: colors.onSurface, fontSize: 19, fontWeight: "800" }, linkText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  horizontal: { gap: 10, paddingBottom: 12, paddingRight: 6 },
  categoryChip: { width: 82, alignItems: "center", gap: 8 }, categoryIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, categoryName: { color: colors.onSurface, fontSize: 11, fontWeight: "700", textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  productCard: { width: "48%", borderRadius: 16, padding: 10, backgroundColor: colors.surfaceSecondary }, productImage: { height: 142, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }, image: { width: "100%", height: "100%", resizeMode: "cover" },
  discount: { position: "absolute", left: 7, top: 7, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: colors.success }, discountText: { color: colors.onSuccess, fontSize: 9, fontWeight: "800" },
  productName: { color: colors.onSurfaceSecondary, fontWeight: "800", fontSize: 13, lineHeight: 18, marginTop: 10 }, productDesc: { color: colors.muted, fontSize: 11, marginTop: 3 }, priceRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 7 }, price: { color: colors.onSurface, fontSize: 15, fontWeight: "900" }, mrp: { color: colors.muted, fontSize: 11, textDecorationLine: "line-through" },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }, rating: { color: colors.warning, fontSize: 11, fontWeight: "700" }, addButton: { minHeight: 32, borderRadius: 16, paddingHorizontal: 9, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", gap: 2 }, addText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800" }, outStock: { color: colors.error, fontSize: 10, fontWeight: "800" },
  pageTitle: { color: colors.onSurface, fontSize: 28, fontWeight: "900", marginBottom: 5 }, pageSubtitle: { color: colors.muted, fontSize: 14, marginBottom: 24 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, categoryCard: { width: "48%", minHeight: 136, borderRadius: 17, padding: 14, backgroundColor: colors.surfaceSecondary, justifyContent: "space-between" }, categoryLargeIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, categoryCardTitle: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "800", marginTop: 10 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 19 },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  filterIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  filterIconActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  applyRow: { paddingVertical: 6, marginBottom: 10 },
  filterPill: { flexShrink: 0, minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }, filterPillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }, filterText: { color: colors.muted, fontSize: 12, fontWeight: "700" }, filterTextActive: { color: colors.onBrandPrimary },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "flex-end" },
  filterSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  rangeRow: { flexDirection: "row", gap: 10 }, rangeInput: { flex: 1 },
  checkRow: { marginTop: 16, padding: 14, borderRadius: 13, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", gap: 10 },
  checkRowActive: { backgroundColor: colors.brandTertiary },
  detailHeader: { minHeight: 62, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider }, headerTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800" },
  detailPage: { padding: 18, paddingBottom: 130 },
  detailImage: { height: 315, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" },
  detailImageAsset: { width: "100%", height: "100%", resizeMode: "contain" },
  zoomHint: { position: "absolute", right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  zoomHintText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "800" },
  thumbs: { gap: 9, paddingVertical: 14 }, thumb: { width: 58, height: 58, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }, thumbActive: { borderColor: colors.brandPrimary, borderWidth: 2 }, thumbImage: { width: "100%", height: "100%" },
  detailTitle: { color: colors.onSurface, fontSize: 26, lineHeight: 31, fontWeight: "900", marginTop: 8 }, ratingLarge: { color: colors.warning, fontWeight: "800", marginTop: 10 }, detailPrice: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 17 }, detailPriceValue: { color: colors.onSurface, fontSize: 25, fontWeight: "900" }, stock: { fontSize: 13, fontWeight: "800", marginTop: 11 }, detailDescription: { color: colors.onSurfaceTertiary, fontSize: 15, lineHeight: 23, marginTop: 22 }, specRow: { flexDirection: "row", gap: 12, marginTop: 24 }, spec: { flex: 1, borderRadius: 13, padding: 13, backgroundColor: colors.surfaceSecondary }, specValue: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13, marginTop: 5 },
  detailActions: { flexDirection: "row", gap: 10, padding: 16, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider },
  secondaryButton: { flex: 1, minHeight: 50, borderRadius: 25, borderWidth: 1, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }, secondaryButtonText: { color: colors.brandPrimary, fontWeight: "900" }, primaryButtonSmall: { flex: 1, minHeight: 50, borderRadius: 25, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  similarRow: { gap: 12, paddingVertical: 12, paddingRight: 6 },
  similarCard: { width: 140, borderRadius: 14, padding: 8, backgroundColor: colors.surfaceSecondary },
  similarImage: { height: 110, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 8 },
  similarName: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 12, marginBottom: 4 },
  reviewForm: { padding: 14, borderRadius: 14, backgroundColor: colors.surfaceSecondary, marginTop: 12, marginBottom: 16 },
  starRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  reviewCard: { padding: 14, borderRadius: 13, backgroundColor: colors.surfaceSecondary, marginBottom: 10 },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  reviewText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  cartItem: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 12, padding: 10, borderRadius: 16, backgroundColor: colors.surfaceSecondary }, cartImage: { width: 78, height: 78, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" }, cartInfo: { flex: 1 }, quantity: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 9 }, quantityButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, quantityText: { color: colors.onSurface, fontWeight: "800" }, cartTotal: { color: colors.onSurface, fontWeight: "900", alignSelf: "flex-start" },
  summary: { marginTop: 18, padding: 16, borderRadius: 16, backgroundColor: colors.surfaceSecondary }, line: { paddingVertical: 8, flexDirection: "row", justifyContent: "space-between" }, body: { color: colors.onSurfaceTertiary, fontSize: 14 }, bold: { color: colors.onSurface, fontWeight: "900", fontSize: 14 }, summaryDivider: { height: 1, marginVertical: 5, backgroundColor: colors.divider }, cod: { marginTop: 14, padding: 11, borderRadius: 11, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.surfaceTertiary }, codText: { color: colors.success, fontSize: 12, fontWeight: "800" },
  bottomAction: { padding: 14, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.divider }, primaryButton: { minHeight: 52, borderRadius: 26, paddingHorizontal: 18, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row" }, primaryButtonText: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14 },
  fieldWrap: { marginBottom: 14 }, fieldLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800", marginBottom: 7, marginTop: 8 }, input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 13, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, fontSize: 14 }, formError: { color: colors.error, fontSize: 12, fontWeight: "700", marginBottom: 12 }, formMessage: { color: colors.success, fontSize: 12, fontWeight: "700", marginTop: 8, marginBottom: 4 },
  deliveryCard: { marginTop: 6, padding: 14, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.surfaceSecondary }, flex: { flex: 1 },
  orderCard: { marginBottom: 12, padding: 16, borderRadius: 16, backgroundColor: colors.surfaceSecondary }, orderTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }, status: { color: colors.brandPrimary, fontSize: 11, fontWeight: "900", textTransform: "capitalize" }, orderTotal: { color: colors.onSurface, fontSize: 21, fontWeight: "900", marginTop: 16 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 15, padding: 18, borderRadius: 18, backgroundColor: colors.surfaceSecondary }, avatar: { width: 55, height: 55, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.onBrandPrimary, fontSize: 23, fontWeight: "900" }, profileName: { color: colors.onSurface, fontSize: 18, fontWeight: "900", marginBottom: 4 },
  adminCard: { marginBottom: 13, padding: 17, borderRadius: 17, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.brandSecondary }, adminTitle: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900" }, adminText: { color: colors.onBrandPrimary, opacity: 0.75, fontSize: 12, marginTop: 3 },
  infoCard: { marginBottom: 11, padding: 16, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: colors.surfaceSecondary },
  outlineButton: { minHeight: 48, marginTop: 18, borderRadius: 24, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" }, outlineText: { color: colors.onSurface, fontWeight: "900" },
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 30, paddingVertical: 80 }, emptyIcon: { width: 72, height: 72, borderRadius: 36, marginBottom: 15, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }, emptyTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 18, textAlign: "center" }, emptyText: { color: colors.muted, textAlign: "center", lineHeight: 20, marginTop: 8 },
  authWrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 25, paddingVertical: 40 }, logoMark: { width: 68, height: 68, borderRadius: 22, marginBottom: 15, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }, authLogo: { color: colors.brandPrimary, fontSize: 35, letterSpacing: 4, fontWeight: "900" }, authTitle: { color: colors.onSurface, fontSize: 28, fontWeight: "900", marginTop: 33 }, authSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 30 }, linkButton: { alignItems: "center", padding: 14 }, adminLink: { minHeight: 44, marginTop: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, muted: { color: colors.muted, fontSize: 13 },
  pendingWrap: { flexGrow: 1, alignItems: "center", padding: 26, paddingTop: 48, gap: 14 },
  pendingBadge: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  pendingText: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 16, marginTop: 4 },
  pendingCard: { alignSelf: "stretch", padding: 16, borderRadius: 14, backgroundColor: colors.surfaceSecondary, marginBottom: 8 },
  uploadBox: { minHeight: 112, marginVertical: 15, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, borderRadius: 15, alignItems: "center", justifyContent: "center", gap: 5 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 }, inlineInput: { flex: 1 }, squareButton: { width: 48, height: 48, borderRadius: 13, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  listRow: { minHeight: 55, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 8 }, flexText: { flex: 1, color: colors.onSurface, fontWeight: "700" },
  adminOrderActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }, smallAction: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 5 }, smallActionText: { color: colors.onSurface, fontSize: 11, fontWeight: "800" },
  manageRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  manageThumb: { width: 60, height: 60, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  stockPill: { position: "absolute", right: 7, top: 7, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 4 },
  stockPillText: { fontSize: 9, fontWeight: "800" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  statCard: { width: "48%", padding: 16, borderRadius: 16, gap: 6, minHeight: 110, justifyContent: "space-between" },
  statCardOutline: { width: "48%", padding: 16, borderRadius: 16, gap: 6, minHeight: 110, backgroundColor: colors.surfaceSecondary, justifyContent: "space-between" },
  statValueLight: { color: colors.onBrandPrimary, fontSize: 22, fontWeight: "900" },
  statLabelLight: { color: colors.onBrandPrimary, opacity: 0.85, fontSize: 11, fontWeight: "700" },
  statValue: { color: colors.onSurface, fontSize: 22, fontWeight: "900" },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  promoCard: { padding: 14, borderRadius: 18, backgroundColor: colors.surfaceSecondary, gap: 10, marginBottom: 20 },
  promoImage: { width: "100%", height: 220, borderRadius: 12 },
  zoomWrap: { flex: 1, backgroundColor: "#000000" },
  zoomClose: { position: "absolute", top: 40, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", zIndex: 10 },
  zoomScroll: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  zoomImage: { width: 380, height: 600 },
}); }
