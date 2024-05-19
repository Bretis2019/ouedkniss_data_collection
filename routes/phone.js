const express = require('express');
const router = express.Router();
const axios = require('axios');
const mysql = require('mysql2/promise');

async function clearData(connection) {
  try {
    await connection.execute('DELETE FROM phone_listings WHERE price IN (1, 123, 111)');
    await connection.execute('DELETE FROM phone_listings WHERE city_id = 0');
  } catch (error) {
    console.error("Error deleting prices:", error);
  }
}

async function insertAveragePrices(connection) {
  try {
    await connection.execute(`
      INSERT INTO average_phone_price (model_name, average_price, date)
      SELECT model_name, ROUND(AVG(price)) AS average_price, CURRENT_TIMESTAMP
      FROM (
        SELECT model_name, price, NTILE(100) OVER (PARTITION BY model_name ORDER BY price) as tile
        FROM phone_listings
        WHERE price IS NOT NULL
      ) t
      WHERE tile NOT IN (1, 10)
      GROUP BY model_name;
    `);
  } catch (error) {
    console.error("Error inserting average prices:", error);
  }
}

function convertToMySQLDatetime(isoDatetime) {
  const date = new Date(isoDatetime);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}


async function getPhoneData(apiClient, model, postCount){
  let data = JSON.stringify({
    "operationName": "SearchQuery",
    "variables": {
      "mediaSize": "MEDIUM",
      "q": model,
      "filter": {
        "categorySlug": "telephones",
        "origin": null,
        "connected": false,
        "delivery": null,
        "regionIds": [],
        "cityIds": [],
        "priceRange": [
          null,
          null
        ],
        "exchange": false,
        "hasPictures": false,
        "hasPrice": true,
        "priceUnit": null,
        "fields": [],
        "page": 1,
        "count": postCount
      }
    },
    "query": "query SearchQuery($q: String, $filter: SearchFilterInput, $mediaSize: MediaSize = MEDIUM) {\n  search(q: $q, filter: $filter) {\n    announcements {\n      data {\n        ...AnnouncementContent\n        smallDescription {\n          valueText\n          __typename\n        }\n        noAdsense\n        __typename\n      }\n      paginatorInfo {\n        lastPage\n        hasMorePages\n        __typename\n      }\n      __typename\n    }\n    active {\n      category {\n        id\n        name\n        slug\n        icon\n        delivery\n        deliveryType\n        priceUnits\n        children {\n          id\n          name\n          slug\n          icon\n          __typename\n        }\n        specifications {\n          isRequired\n          specification {\n            id\n            codename\n            label\n            type\n            class\n            datasets {\n              codename\n              label\n              __typename\n            }\n            dependsOn {\n              id\n              codename\n              __typename\n            }\n            subSpecifications {\n              id\n              codename\n              label\n              type\n              __typename\n            }\n            allSubSpecificationCodenames\n            __typename\n          }\n          __typename\n        }\n        parentTree {\n          id\n          name\n          slug\n          icon\n          children {\n            id\n            name\n            slug\n            icon\n            __typename\n          }\n          __typename\n        }\n        parent {\n          id\n          name\n          icon\n          __typename\n        }\n        __typename\n      }\n      count\n      __typename\n    }\n    suggested {\n      category {\n        id\n        name\n        slug\n        icon\n        __typename\n      }\n      count\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment AnnouncementContent on Announcement {\n  id\n  title\n  slug\n  createdAt: refreshedAt\n  isFromStore\n  isCommentEnabled\n  userReaction {\n    isBookmarked\n    isLiked\n    __typename\n  }\n  hasDelivery\n  deliveryType\n  likeCount\n  description\n  status\n  cities {\n    id\n    name\n    slug\n    region {\n      id\n      name\n      slug\n      __typename\n    }\n    __typename\n  }\n  store {\n    id\n    name\n    slug\n    imageUrl\n    isOfficial\n    isVerified\n    __typename\n  }\n  user {\n    id\n    __typename\n  }\n  defaultMedia(size: $mediaSize) {\n    mediaUrl\n    mimeType\n    thumbnail\n    __typename\n  }\n  price\n  pricePreview\n  priceUnit\n  oldPrice\n  oldPricePreview\n  priceType\n  exchangeType\n  category {\n    id\n    slug\n    __typename\n  }\n  __typename\n}\n"
  });

  try {
    const response = await apiClient.post('/graphql', data);
    return response.data.data.search.announcements.data.map(item => ({
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
      likeCount: item.likeCount,
      price: item.price,
      city: item.cities[0]?.region?.id || 0
    }));
  } catch (error) {
    console.error("Error fetching phone data:", error);
  }
}

async function insertPhoneListings(connection, listings, model) {
  try {
    for (const listing of listings) {
      await connection.execute(
          `INSERT INTO phone_listings (model_name, post_id, title, created_at, like_count, price, city_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [model, listing.id, listing.title, convertToMySQLDatetime(listing.createdAt), listing.likeCount, listing.price, listing.city]
      );
    }
    await connection.execute('DELETE FROM phone_listings WHERE title NOT LIKE CONCAT(\'%\', model_name, \'%\');');
  } catch (error) {
    if(error.code !== 'ER_DUP_ENTRY'){
      console.error(error);
    }
  }
}

router.get('/get', async function (req, res, next) {
  const apiClient = axios.create({
    baseURL: 'https://api.ouedkniss.com',
    headers: {
      'Content-Type': 'application/json'
    },
    maxBodyLength: Infinity
  });

  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Farid1966',
    database: 'ouedkniss'
  });
  await connection.execute('SET SQL_SAFE_UPDATES = 0');

  const models = ["S24 Ultra", "S23 Ultra", "S23 Plus", "S23", "S22 Ultra", "S22 Plus", "S22", "S21 Ultra", "S21 Plus", "S21", "Iphone 15 Pro Max", "Iphone 14 Pro Max", "Iphone 13 Pro Max", "Iphone 13 Plus", "Iphone 13 mini", "Iphone 13", "Iphone 12 Pro Max", "Iphone 12 Plus", "Iphone 12 mini", "Iphone 12"];
  try {
    for (const model of models) {
      const response = await getPhoneData(apiClient, model, 100);
      await insertPhoneListings(connection, response, model);
    }
    await clearData(connection);
    await insertAveragePrices(connection);
    res.status(200).json({ success: true, message: "Success" });
  } catch (error) {
    res.status(500).json({ error: error, message: "Failed to fetch phone data" });
  } finally {
    await connection.execute('SET SQL_SAFE_UPDATES = 1');
    await connection.end();
  }

});

module.exports = router;
