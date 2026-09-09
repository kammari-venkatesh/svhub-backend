import mongoose from 'mongoose'
import { connectDb } from '../src/config/db.js'
import { User, Order, Counter } from '../src/models/index.js'

async function seedOrders() {
  await connectDb()

  const customer = await User.findOne({ email: 'customer@svhub.in' })
  const custId = customer ? customer._id : new mongoose.Types.ObjectId()

  const existing = await Order.findOne({ orderNumber: '#SVH-1001' })
  if (existing) {
    console.log('Demo orders already seeded.')
    process.exit(0)
  }

  const order1 = await Order.create({
    orderNumber: '#SVH-1001',
    userId: custId,
    customerName: 'Priya Venkatesh',
    email: 'priya.venkatesh@email.com',
    phone: '9876543210',
    shippingAddress: {
      name: 'Priya Venkatesh',
      phone: '9876543210',
      street: '12 Heritage Lane, RS Puram',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pin: '641002',
      country: 'India',
      lines: ['12 Heritage Lane, RS Puram', 'Coimbatore, Tamil Nadu - 641002'],
    },
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: 'var-samba-500g',
        productName: 'Mappillai Samba Rice',
        variantLabel: '500g',
        weight: '500g',
        sku: 'SKU-SAMBA-500',
        unitPrice: 249,
        originalPrice: 289,
        discount: 14,
        quantity: 2,
        lineTotal: 498,
        image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80',
        storefront: 'nutri-hub',
      },
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: 'var-thokku-200g',
        productName: 'Venthaya Thokku',
        variantLabel: '200g',
        weight: '200g',
        sku: 'SKU-THOKKU-200',
        unitPrice: 152,
        originalPrice: 180,
        discount: 15,
        quantity: 1,
        lineTotal: 152,
        image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80',
        storefront: 'nutri-hub',
      },
    ],
    subtotal: 650,
    shippingFee: 0,
    discount: 0,
    totalAmount: 650,
    status: 'CONFIRMED',
    paymentStatus: 'SUCCESS',
    paymentMethod: 'Razorpay',
    notes: 'Please pack in eco-friendly carton.',
    history: [
      {
        status: 'PENDING_PAYMENT',
        at: new Date(Date.now() - 7200000),
        note: 'Order placed by customer',
      },
      {
        status: 'CONFIRMED',
        at: new Date(Date.now() - 3600000),
        note: 'Payment captured and verified',
      },
    ],
  })

  const order2 = await Order.create({
    orderNumber: '#SVH-1002',
    userId: custId,
    customerName: 'Arjun Menon',
    email: 'arjun.menon@email.com',
    phone: '9840122334',
    shippingAddress: {
      name: 'Arjun Menon',
      phone: '9840122334',
      street: '45 Green Meadows, Anna Nagar',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pin: '600040',
      country: 'India',
      lines: ['45 Green Meadows, Anna Nagar', 'Chennai, Tamil Nadu - 600040'],
    },
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: 'var-sesame-1l',
        productName: 'Cold Pressed Sesame Oil',
        variantLabel: '1 Litre',
        weight: '1L',
        sku: 'SKU-SESAME-1L',
        unitPrice: 420,
        originalPrice: 480,
        discount: 12,
        quantity: 1,
        lineTotal: 420,
        image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80',
        storefront: 'nutri-hub',
      },
    ],
    subtotal: 420,
    shippingFee: 50,
    discount: 0,
    totalAmount: 470,
    status: 'PROCESSING',
    paymentStatus: 'SUCCESS',
    paymentMethod: 'Razorpay',
    courier: 'BlueDart Express',
    trackingNumber: 'BLU-SVH1002',
    notes: 'Packed and queued for dispatch.',
    history: [
      {
        status: 'PENDING_PAYMENT',
        at: new Date(Date.now() - 14400000),
        note: 'Order placed',
      },
      {
        status: 'CONFIRMED',
        at: new Date(Date.now() - 10800000),
        note: 'Payment confirmed',
      },
      {
        status: 'PROCESSING',
        at: new Date(Date.now() - 7200000),
        note: 'Sent to packing department',
      },
    ],
  })

  console.log('Seeded demo orders:', order1.orderNumber, order2.orderNumber)
  process.exit(0)
}

seedOrders()
