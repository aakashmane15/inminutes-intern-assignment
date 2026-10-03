import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const menuItems = [
  {
    id: "classic-burger",
    name: "Classic Burger",
    description: "Patty, lettuce, tomato, and sauce.",
    pricePaise: 18900,
    stock: 8,
    active: true,
  },
  {
    id: "masala-fries",
    name: "Masala Fries",
    description: "Crispy fries with seasoning.",
    pricePaise: 8900,
    stock: 12,
    active: true,
  },
  {
    id: "paneer-roll",
    name: "Paneer Roll",
    description: "Paneer tikka wrapped sauce.",
    pricePaise: 12900,
    stock: 6,
    active: true,
  },
  {
    id: "last-unit-special",
    name: "Last-Unit Special",
    description: "Race for the last item",
    pricePaise: 9900,
    stock: 1,
    active: true,
  },
];

try {
  for (const item of menuItems) {
    const { id, ...values } = item;

    await prisma.menuItem.upsert({
      where: { id },
      update: values,
      create: item,
    });
  }

  console.log(`Seeded ${menuItems.length} menu items.`);
} catch (error) {
  console.error("Could not seed menu data:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
