import mongoose from 'mongoose'

const counterSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'Counter key is required'],
      unique: true,
      trim: true,
      index: true,
    },
    sequence: {
      type: Number,
      required: true,
      default: 10000,
      min: [0, 'Sequence cannot be negative'],
    },
  },
  {
    timestamps: true,
  },
)

// Atomic sequential counter increment
counterSchema.statics.getNextSequence = async function getNextSequence(key, startAt = 10000) {
  const existing = await this.findOne({ key })
  if (!existing) {
    try {
      const created = await this.create({ key, sequence: startAt + 1 })
      return created.sequence
    } catch (err) {
      if (err.code !== 11000) throw err
    }
  }
  const counter = await this.findOneAndUpdate(
    { key },
    { $inc: { sequence: 1 } },
    { returnDocument: 'after' },
  )
  return counter.sequence
}

export const Counter = mongoose.model('Counter', counterSchema)
