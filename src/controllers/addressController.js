import mongoose from 'mongoose'
import { Address } from '../models/Address.js'
import { phoneError, normalizePhone } from '../utils/auth.js'

export function formatPublicAddress(addr) {
  const streetLine = [addr.house, addr.street, addr.area].filter(Boolean).join(', ') || addr.street
  return {
    id: String(addr._id),
    userId: String(addr.userId),
    label: addr.label || 'Home',
    name: addr.name,
    fullName: addr.name,
    phone: addr.phone,
    house: addr.house || '',
    street: addr.street,
    area: addr.area || '',
    landmark: addr.landmark || '',
    addressLine1: streetLine,
    city: addr.city,
    state: addr.state,
    pin: addr.pin,
    postalCode: addr.pin,
    country: addr.country || 'India',
    location: {
      latitude: addr.location?.latitude ?? null,
      longitude: addr.location?.longitude ?? null,
    },
    latitude: addr.location?.latitude ?? null,
    longitude: addr.location?.longitude ?? null,
    isDefault: Boolean(addr.isDefault),
    lines: [
      streetLine,
      `${addr.city}, ${addr.state}`,
      `${addr.pin}, ${addr.country || 'India'}`,
    ],
    createdAt: addr.createdAt,
    updatedAt: addr.updatedAt,
  }
}

// 1. Get all saved delivery addresses for authenticated customer
export async function getAddresses(req, res, next) {
  try {
    const addresses = await Address.find({ userId: req.user._id }).sort({
      isDefault: -1,
      createdAt: -1,
    })

    res.json({
      success: true,
      data: addresses.map(formatPublicAddress),
    })
  } catch (err) {
    next(err)
  }
}

// 2. Create new delivery address
export async function createAddress(req, res, next) {
  try {
    const name = String(req.body?.name || req.body?.fullName || '').trim()
    const rawPhone = req.body?.phone !== undefined && req.body?.phone !== null ? String(req.body.phone).trim() : ''
    const house = String(req.body?.house || '').trim()
    const street = String(req.body?.street || req.body?.addressLine1 || '').trim()
    const area = String(req.body?.area || '').trim()
    const landmark = String(req.body?.landmark || '').trim()
    const city = String(req.body?.city || '').trim()
    const state = String(req.body?.state || '').trim()
    const pin = String(req.body?.pin || req.body?.postalCode || '').trim()
    const label = String(req.body?.label || 'Home').trim()
    const country = String(req.body?.country || 'India').trim()
    const lat = req.body?.latitude !== undefined ? Number(req.body.latitude) : req.body?.location?.latitude !== undefined ? Number(req.body.location.latitude) : null
    const lng = req.body?.longitude !== undefined ? Number(req.body.longitude) : req.body?.location?.longitude !== undefined ? Number(req.body.location.longitude) : null
    const location = Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : { latitude: null, longitude: null }

    if (!name || name.length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_name',
          message: 'Recipient name must be at least 2 characters.',
        },
      })
    }

    const phoneIssue = phoneError(rawPhone)
    if (phoneIssue) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_phone',
          message: phoneIssue,
        },
      })
    }
    const phone = normalizePhone(rawPhone)

    if (!street && !house) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_street',
          message: 'Street or house address is required.',
        },
      })
    }

    if (!city) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_city',
          message: 'City is required.',
        },
      })
    }

    if (!state) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_state',
          message: 'State is required.',
        },
      })
    }

    if (!pin || !/^\d{6}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'invalid_pin',
          message: 'A valid 6-digit PIN code is required.',
        },
      })
    }

    // Determine default address status
    const count = await Address.countDocuments({ userId: req.user._id })
    const isFirst = count === 0
    const shouldBeDefault = isFirst || Boolean(req.body.isDefault)

    if (shouldBeDefault && count > 0) {
      await Address.updateMany(
        { userId: req.user._id },
        { $set: { isDefault: false } },
      )
    }

    const address = await Address.create({
      userId: req.user._id,
      label: ['Home', 'Work', 'Other'].includes(label) ? label : 'Home',
      name,
      phone,
      house,
      street: street || house,
      area,
      landmark,
      city,
      state,
      pin,
      country,
      location,
      isDefault: shouldBeDefault,
    })

    res.status(201).json({
      success: true,
      data: formatPublicAddress(address),
    })
  } catch (err) {
    next(err)
  }
}

// 3. Update customer address
export async function updateAddress(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    const address = await Address.findOne({ _id: id, userId: req.user._id })
    if (!address) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    const name = req.body?.name !== undefined || req.body?.fullName !== undefined
      ? String(req.body?.name || req.body?.fullName || '').trim()
      : undefined
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : undefined
    const house = req.body?.house !== undefined ? String(req.body.house).trim() : undefined
    const street = req.body?.street !== undefined || req.body?.addressLine1 !== undefined
      ? String(req.body?.street || req.body?.addressLine1 || '').trim()
      : undefined
    const area = req.body?.area !== undefined ? String(req.body.area).trim() : undefined
    const landmark = req.body?.landmark !== undefined ? String(req.body.landmark).trim() : undefined
    const city = req.body?.city !== undefined ? String(req.body.city).trim() : undefined
    const state = req.body?.state !== undefined ? String(req.body.state).trim() : undefined
    const pin = req.body?.pin !== undefined || req.body?.postalCode !== undefined
      ? String(req.body?.pin || req.body?.postalCode || '').trim()
      : undefined
    const label = req.body?.label !== undefined ? String(req.body.label).trim() : undefined
    const country = req.body?.country !== undefined ? String(req.body.country).trim() : undefined

    if (name !== undefined) {
      if (!name || name.length < 2) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_name',
            message: 'Recipient name must be at least 2 characters.',
          },
        })
      }
      address.name = name
    }

    if (phone !== undefined) {
      const phoneIssue = phoneError(phone)
      if (phoneIssue) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_phone',
            message: phoneIssue,
          },
        })
      }
      address.phone = normalizePhone(phone)
    }

    if (house !== undefined) {
      address.house = house
    }

    if (street !== undefined) {
      if (!street && !address.house) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_street',
            message: 'Street address is required.',
          },
        })
      }
      address.street = street || address.house
    }

    if (area !== undefined) {
      address.area = area
    }

    if (landmark !== undefined) {
      address.landmark = landmark
    }

    if (city !== undefined) {
      if (!city) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_city',
            message: 'City is required.',
          },
        })
      }
      address.city = city
    }

    if (state !== undefined) {
      if (!state) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_state',
            message: 'State is required.',
          },
        })
      }
      address.state = state
    }

    if (pin !== undefined) {
      if (!pin || !/^\d{6}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'invalid_pin',
            message: 'A valid 6-digit PIN code is required.',
          },
        })
      }
      address.pin = pin
    }

    if (label !== undefined && ['Home', 'Work', 'Other'].includes(label)) {
      address.label = label
    }

    if (country !== undefined) {
      address.country = country
    }

    const lat = req.body?.latitude !== undefined ? Number(req.body.latitude) : req.body?.location?.latitude !== undefined ? Number(req.body.location.latitude) : undefined
    const lng = req.body?.longitude !== undefined ? Number(req.body.longitude) : req.body?.location?.longitude !== undefined ? Number(req.body.location.longitude) : undefined
    if (lat !== undefined && lng !== undefined) {
      address.location = Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : { latitude: null, longitude: null }
    }

    if (req.body?.isDefault === true) {
      await Address.updateMany(
        { userId: req.user._id, _id: { $ne: address._id } },
        { $set: { isDefault: false } },
      )
      address.isDefault = true
    }

    await address.save()

    res.json({
      success: true,
      data: formatPublicAddress(address),
    })
  } catch (err) {
    next(err)
  }
}

// 4. Delete customer address
export async function deleteAddress(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    const address = await Address.findOne({ _id: id, userId: req.user._id })
    if (!address) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    const wasDefault = address.isDefault
    await Address.deleteOne({ _id: address._id })

    // If deleted address was default, promote next available address to default
    if (wasDefault) {
      const nextAddr = await Address.findOne({ userId: req.user._id }).sort({
        createdAt: -1,
      })
      if (nextAddr) {
        nextAddr.isDefault = true
        await nextAddr.save()
      }
    }

    res.json({
      success: true,
      message: 'Address deleted successfully.',
    })
  } catch (err) {
    next(err)
  }
}

// 5. Mark address as primary default
export async function setDefaultAddress(req, res, next) {
  try {
    const id = String(req.params.id || '').trim()
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    const address = await Address.findOne({ _id: id, userId: req.user._id })
    if (!address) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'address_not_found',
          message: 'Address not found.',
        },
      })
    }

    // Unset default on all other addresses belonging ONLY to this user
    await Address.updateMany(
      { userId: req.user._id, _id: { $ne: address._id } },
      { $set: { isDefault: false } },
    )

    address.isDefault = true
    await address.save()

    res.json({
      success: true,
      data: formatPublicAddress(address),
    })
  } catch (err) {
    next(err)
  }
}
