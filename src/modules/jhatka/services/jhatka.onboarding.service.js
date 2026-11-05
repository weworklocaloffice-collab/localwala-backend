const { status: httpStatus } = require('http-status');
const {
  User,
  Business,
  City,
  Locality,
  JhatkaPartner,
  JhatkaOutlet,
  JhatkaTenantRoleAssignment,
  JhatkaCompliance,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const verticalService = require('../../../kernel/vertical/services/vertical.service');

const BUSINESS_MODELS = ['direct', 'franchise', 'commission_partner'];
const JHATKA_PARTNER_ROLE = 'jhatkaPartner';

const digits = (value) => String(value || '').replace(/\D/g, '');

const cityPrefix = async (cityId) => {
  const city = await City.findById(cityId).select('name').lean();
  if (!city) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That city is not one we serve');
  }
  return {
    city,
    prefix: String(city.name || 'OUT').replace(/[^A-Za-z]/g, '').slice(0, 8).toUpperCase() || 'OUT',
  };
};

const assertLocationPairing = async (cityId, localityId) => {
  const city = await City.findOne({ _id: cityId, status: true }).select('_id name').lean();

  if (!city) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That city is not one we serve');
  }

  // A business can be created from the admin city list before a locality has
  // been chosen. Partner self-registration still always supplies the pair.
  if (!localityId) return city;

  const locality = await Locality.findOne({ _id: localityId, status: true })
    .select('_id city')
    .lean();
  if (!locality) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That locality is not one we serve');
  }
  if (String(locality.city) !== String(cityId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That locality does not belong to the selected city');
  }

  return city;
};

const generatePartnerCode = async (cityId) => {
  const { prefix } = await cityPrefix(cityId);
  const codePrefix = `JP-${prefix}`;
  const rows = await JhatkaPartner.find({ partnerCode: new RegExp(`^${codePrefix}-`) })
    .select('partnerCode')
    .lean();
  const used = new Set(rows.map((row) => row.partnerCode));
  let next = 1;
  while (used.has(`${codePrefix}-${String(next).padStart(4, '0')}`)) next += 1;
  return `${codePrefix}-${String(next).padStart(4, '0')}`;
};

const generateOutletCode = async (cityId) => {
  const { prefix } = await cityPrefix(cityId);
  const codePrefix = `JH-${prefix}`;
  const rows = await JhatkaOutlet.find({ outletCode: new RegExp(`^${codePrefix}-`) })
    .select('outletCode')
    .lean();
  const used = new Set(rows.map((row) => row.outletCode));
  let next = 1;
  while (used.has(`${codePrefix}-${String(next).padStart(4, '0')}`)) next += 1;
  return `${codePrefix}-${String(next).padStart(4, '0')}`;
};

const createBusiness = async (param, session = null) => {
  if (!param?.name || !String(param.name).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'name is required');
  }

  const businessModel = param.businessModel || 'direct';
  if (!BUSINESS_MODELS.includes(businessModel)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `businessModel must be one of ${BUSINESS_MODELS.join(' | ')}`);
  }

  await verticalService.assertRegistered('jhatka');
  const city = await assertLocationPairing(param.city, param.locality);

  const code = param.code ? String(param.code).toUpperCase().trim() : undefined;
  if (code) {
    const duplicate = await Business.findOne({ vertical: 'jhatka', code }).select('_id').lean();
    if (duplicate) {
      throw new ApiError(httpStatus.CONFLICT, 'A Jhatka business with that code already exists');
    }
  }

  const mobile = digits(param.contact?.mobile);

  const [business] = await Business.create(
    [
      {
        vertical: 'jhatka',
        businessModel,
        name: String(param.name).trim(),
        code,
        description: param.description,
        logo: param.logo,
        cover: param.cover,
        city: city._id,
        locality: param.locality || undefined,
        location: param.location,
        owner: param.owner || undefined,
        contact: {
          name: param.contact?.name,
          mobile: mobile ? Number(mobile) : undefined,
          countryCode: param.contact?.countryCode,
          email: param.contact?.email,
        },
        verified: false,
        status: true,
      },
    ],
    { session }
  );

  return business;
};

const createPartner = async (param, session = null) => {
  const partnerCode = param.partnerCode
    ? String(param.partnerCode).toUpperCase().trim()
    : await generatePartnerCode(param.city);
  const mobile = digits(param.mobile);

  const [partner] = await JhatkaPartner.create(
    [
      {
        partnerCode,
        business: param.business,
        owner: param.owner,
        ownerName: param.ownerName,
        name: param.name,
        contact: {
          name: param.ownerName,
          mobile: mobile ? Number(mobile) : undefined,
          countryCode: String(param.countryCode || '').replace(/\D/g, ''),
          email: param.email,
        },
        address: {
          line1: param.addressLine1,
          city: param.city,
          locality: param.locality || undefined,
        },
        outlets: param.outlet
          ? [{ outlet: param.outlet, isPrimary: true, addedAt: new Date() }]
          : [],
        status: 'pending',
      },
    ],
    { session }
  );

  return partner;
};

const createOutlet = async (param, session = null) => {
  const outletCode = param.outletCode
    ? String(param.outletCode).toUpperCase().trim()
    : await generateOutletCode(param.city);

  const [outlet] = await JhatkaOutlet.create(
    [
      {
        outletCode,
        business: param.business,
        businessModel: param.businessModel,
        name: param.name,
        description: param.description,
        logo: param.logo,
        cover: param.cover,
        contact: param.contact,
        address: { line1: param.addressLine1 },
        city: param.city,
        locality: param.locality || undefined,
        location: param.location,
        taxIdentity: param.taxIdentity,
        status: 'pending_approval',
      },
    ],
    { session }
  );

  return outlet;
};

const registerPartner = async (param) => {
  const mobile = digits(param.mobile);
  const countryCode = digits(param.countryCode);
  const email = String(param.email || '').trim().toLowerCase();

  if (!mobile || !countryCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'countryCode and mobile are required');
  }

  const [phoneUser, emailUser] = await Promise.all([
    User.findOne({ countryCode: Number(countryCode), mobile }).select('_id').lean(),
    email ? User.findOne({ email }).select('_id').lean() : null,
  ]);
  if (phoneUser) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already registered');
  }
  if (emailUser) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already registered');
  }

  await assertLocationPairing(param.city, param.locality);
  await verticalService.assertRegistered('jhatka');

  const created = await withOptionalTransaction(async (session) => {
    const [user] = await User.create(
      [
        {
          firstName: param.firstName,
          lastName: param.lastName,
          countryCode: Number(countryCode),
          mobile,
          email,
          password: param.password,
          role: JHATKA_PARTNER_ROLE,
          locale: param.locale || 'en',
          isMobileVerified: true,
          status: true,
        },
      ],
      { session }
    );

    const business = await createBusiness(
      {
        name: param.businessName,
        businessModel: param.businessModel,
        city: param.city,
        locality: param.locality,
        owner: user._id,
        contact: {
          name: `${param.firstName} ${param.lastName}`.trim(),
          mobile,
          countryCode: `+${countryCode}`,
          email,
        },
      },
      session
    );

    const outlet = await createOutlet(
      {
        business: business._id,
        businessModel: business.businessModel,
        name: param.businessName,
        addressLine1: param.addressLine1,
        city: param.city,
        locality: param.locality,
        contact: {
          name: `${param.firstName} ${param.lastName}`.trim(),
          mobile: Number(mobile),
          countryCode: `+${countryCode}`,
          email,
        },
      },
      session
    );

    const partner = await createPartner(
      {
        business: business._id,
        owner: user._id,
        ownerName: `${param.firstName} ${param.lastName}`.trim(),
        name: param.businessName,
        mobile,
        countryCode: `+${countryCode}`,
        email,
        addressLine1: param.addressLine1,
        city: param.city,
        locality: param.locality,
        outlet: outlet._id,
      },
      session
    );

    const [assignment] = await JhatkaTenantRoleAssignment.create(
      [
        {
          user: user._id,
          outlet: outlet._id,
          business: business._id,
          role: 'owner',
          scopeType: 'outlet',
          outlets: [outlet._id],
          isPrimary: true,
          status: 'active',
          canGrantOwner: true,
          grantedByName: 'Partner self-registration',
        },
      ],
      { session }
    );

    let compliance = null;
    if (param.fssaiLicence && param.fssaiExpiry) {
      const expiresAt = new Date(param.fssaiExpiry);
      if (!Number.isNaN(expiresAt.getTime())) {
        [compliance] = await JhatkaCompliance.create(
          [
            {
              outlet: outlet._id,
              business: business._id,
              fssai: {
                licenceNumber: String(param.fssaiLicence).trim(),
                category: 'registration',
                expiresAt,
              },
              status: 'pending',
            },
          ],
          { session }
        );
      }
    }

    return { user, business, outlet, partner, assignment, compliance };
  });

  return created;
};

const ensureAdminBusiness = async (param) => {
  const business = await createBusiness(param);
  return Business.findById(business._id)
    .select('name code businessModel logo city owner contact')
    .populate('city', 'name state')
    .lean();
};

module.exports = {
  BUSINESS_MODELS,
  assertLocationPairing,
  generateOutletCode,
  generatePartnerCode,
  createBusiness,
  createPartner,
  createOutlet,
  registerPartner,
  ensureAdminBusiness,
};
