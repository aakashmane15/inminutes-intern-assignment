/*
  Warnings:

  - You are about to drop the column `price_paise` on the `order_items` table. All the data in the column will be lost.
  - Added the required column `price_cents` to the `order_items` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "price_paise",
ADD COLUMN     "price_cents" INTEGER NOT NULL;
