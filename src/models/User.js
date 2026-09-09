import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    passwordHash: {
      type: String,
      default: '',
    },
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    provider: {
      type: String,
      enum: ['PASSWORD', 'GOOGLE', 'password', 'google'],
      default: 'PASSWORD',
      set: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    },
    role: {
      type: String,
      enum: {
        values: ['CUSTOMER', 'ADMIN'],
        message: '{VALUE} is not a valid role',
      },
      default: 'CUSTOMER',
      index: true,
      set: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'VIP', 'INACTIVE', 'SUSPENDED'],
        message: '{VALUE} is not a valid account status',
      },
      default: 'ACTIVE',
      index: true,
      set: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    },
    resetTokenHash: {
      type: String,
      default: '',
    },
    resetTokenExpires: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  },
)

userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    phone: this.phone || '',
    role: (this.role || 'CUSTOMER').toUpperCase(),
    status: (this.status || 'ACTIVE').toUpperCase(),
    hasPassword: Boolean(this.passwordHash),
    provider: (this.provider || 'PASSWORD').toUpperCase(),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  }
}

export const User = mongoose.model('User', userSchema)
