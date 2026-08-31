import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    passwordHash: { type: String, default: '' },
    firebaseUid: { type: String, unique: true, sparse: true, trim: true },
    provider: { type: String, enum: ['password', 'google'], default: 'password' },
    resetTokenHash: { type: String, default: '' },
    resetTokenExpires: { type: Date, default: null },
  },
  { timestamps: true },
)

userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    phone: this.phone,
    hasPassword: Boolean(this.passwordHash),
  }
}

export const User = mongoose.model('User', userSchema)
